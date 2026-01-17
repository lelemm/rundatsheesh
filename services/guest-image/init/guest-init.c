#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static void log_line(const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  vfprintf(stderr, fmt, ap);
  fprintf(stderr, "\n");
  va_end(ap);
}

static void redirect_stdio_to_console(void) {
  // Ensure our logs are visible on Firecracker serial console.
  // /dev/console is typically wired to ttyS0 via kernel cmdline.
  int fd = open("/dev/console", O_WRONLY | O_CLOEXEC);
  if (fd >= 0) {
    dup2(fd, 1);
    dup2(fd, 2);
    close(fd);
    return;
  }
  // Best-effort fallback.
  fd = open("/dev/ttyS0", O_WRONLY | O_CLOEXEC);
  if (fd >= 0) {
    dup2(fd, 1);
    dup2(fd, 2);
    close(fd);
  }
}

static void ensure_dir(const char *p, mode_t mode) {
  if (mkdir(p, mode) != 0 && errno != EEXIST) {
    log_line("mkdir(%s) failed: %s", p, strerror(errno));
  }
}

static pid_t spawn(const char *path, char *const argv[]) {
  pid_t pid = fork();
  if (pid < 0) {
    log_line("fork() failed: %s", strerror(errno));
    return -1;
  }
  if (pid == 0) {
    execv(path, argv);
    log_line("execv(%s) failed: %s", path, strerror(errno));
    _exit(127);
  }
  return pid;
}

static int run_wait(const char *path, char *const argv[]) {
  pid_t pid = spawn(path, argv);
  if (pid < 0) return -1;
  int status = 0;
  if (waitpid(pid, &status, 0) < 0) {
    log_line("waitpid(%s) failed: %s", path, strerror(errno));
    return -1;
  }
  return status;
}

int main(void) {
  ensure_dir("/var", 0755);
  ensure_dir("/var/log", 0755);
  redirect_stdio_to_console();

  log_line("[init] pid=%d starting", (int)getpid());
  setenv("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", 1);

  ensure_dir("/proc", 0555);
  ensure_dir("/sys", 0555);
  ensure_dir("/dev", 0755);
  if (mount("proc", "/proc", "proc", 0, NULL) != 0) log_line("mount /proc failed: %s", strerror(errno));
  if (mount("sysfs", "/sys", "sysfs", 0, NULL) != 0) log_line("mount /sys failed: %s", strerror(errno));
  if (mount("devtmpfs", "/dev", "devtmpfs", 0, NULL) != 0) log_line("mount /dev failed: %s", strerror(errno));

  // Minimal rootfs doesn't bring up loopback automatically, but we rely on 127.0.0.1
  // for the vsock->tcp bridge (socat) to reach the guest agent.
  log_line("[init] bringing up loopback");
  char *ip_lo_up[] = { (char *)"ip", (char *)"link", (char *)"set", (char *)"lo", (char *)"up", NULL };
  run_wait("/sbin/ip", ip_lo_up);
  char *ip_lo_addr[] = { (char *)"ip", (char *)"addr", (char *)"add", (char *)"127.0.0.1/8", (char *)"dev", (char *)"lo", NULL };
  // Ignore error if already assigned.
  run_wait("/sbin/ip", ip_lo_addr);

  log_line("[init] starting guest-agent");
  setenv("PORT", "8080", 1);
  chdir("/opt/guest-agent");
  char *node_argv[] = { (char *)"node", (char *)"/opt/guest-agent/dist/index.js", NULL };
  pid_t node_pid = spawn("/usr/local/bin/node", node_argv);
  if (node_pid > 0) log_line("[init] guest-agent pid=%d", (int)node_pid);

  // Give the HTTP server a moment to bind before we accept vsock connections.
  usleep(200 * 1000);

  log_line("[init] starting socat vsock->tcp");
  char *socat_argv[] = { (char *)"socat", (char *)"VSOCK-LISTEN:8080,fork", (char *)"TCP:127.0.0.1:8080", NULL };
  pid_t socat_pid = spawn("/usr/bin/socat", socat_argv);
  if (socat_pid > 0) log_line("[init] socat pid=%d", (int)socat_pid);

  int status = 0;
  if (node_pid > 0) {
    waitpid(node_pid, &status, 0);
    log_line("[init] guest-agent exited status=%d", status);
  }

  for (;;) {
    sleep(3600);
  }
}

