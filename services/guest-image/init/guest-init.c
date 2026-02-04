#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

// Shell variant: "busybox" (default) or "bash" (NVM support).
// Set at compile time via -DSHELL_VARIANT=\"bash\" or defaults to busybox.
#ifndef SHELL_VARIANT
#define SHELL_VARIANT "busybox"
#endif

// Overlay device path - /dev/vdb is the second virtio-blk device
#define OVERLAY_DEV "/dev/vdb"
#define OVERLAY_MNT "/mnt/overlay"
#define MERGED_ROOT "/mnt/merged"
#define OLD_ROOT "/mnt/merged/oldroot"

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

static bool file_exists(const char *path) {
  struct stat st;
  return stat(path, &st) == 0;
}

// Check if overlay device exists and we should use overlayfs mode
static bool should_use_overlay(void) {
  return file_exists(OVERLAY_DEV);
}

// Set up overlayfs with the current root as lower and /dev/vdb as upper
// Returns true if overlay was set up and we pivoted to it
static bool setup_overlay(void) {
  log_line("[init] overlay device detected at %s", OVERLAY_DEV);

  // Create mount points
  ensure_dir("/mnt", 0755);
  ensure_dir(OVERLAY_MNT, 0755);
  ensure_dir(MERGED_ROOT, 0755);

  // Mount the overlay disk
  log_line("[init] mounting overlay disk");
  if (mount(OVERLAY_DEV, OVERLAY_MNT, "ext4", 0, NULL) != 0) {
    log_line("[init] failed to mount overlay disk: %s", strerror(errno));
    return false;
  }

  // Create overlay directories on the overlay disk
  char upper_dir[256], work_dir[256];
  snprintf(upper_dir, sizeof(upper_dir), "%s/upper", OVERLAY_MNT);
  snprintf(work_dir, sizeof(work_dir), "%s/work", OVERLAY_MNT);
  ensure_dir(upper_dir, 0755);
  ensure_dir(work_dir, 0755);

  // Mount overlayfs with current root (/) as lowerdir
  // The current root is already mounted read-only from /dev/vda
  char overlay_opts[512];
  snprintf(overlay_opts, sizeof(overlay_opts),
           "lowerdir=/,upperdir=%s,workdir=%s", upper_dir, work_dir);

  log_line("[init] mounting overlayfs: %s", overlay_opts);
  if (mount("overlay", MERGED_ROOT, "overlay", 0, overlay_opts) != 0) {
    log_line("[init] failed to mount overlayfs: %s", strerror(errno));
    // Unmount overlay disk on failure
    umount(OVERLAY_MNT);
    return false;
  }

  // Create oldroot directory in merged root for pivot_root
  char oldroot_path[256];
  snprintf(oldroot_path, sizeof(oldroot_path), "%s/oldroot", MERGED_ROOT);
  ensure_dir(oldroot_path, 0755);

  // Pivot root to the overlayfs
  log_line("[init] pivoting root to overlayfs");
  if (syscall(SYS_pivot_root, MERGED_ROOT, oldroot_path) != 0) {
    log_line("[init] pivot_root failed: %s", strerror(errno));
    umount(MERGED_ROOT);
    umount(OVERLAY_MNT);
    return false;
  }

  // Change to new root
  if (chdir("/") != 0) {
    log_line("[init] chdir(/) failed: %s", strerror(errno));
  }

  // Unmount old root (lazy unmount to handle busy mounts)
  log_line("[init] unmounting old root");
  if (umount2("/oldroot", MNT_DETACH) != 0) {
    log_line("[init] umount oldroot failed (non-fatal): %s", strerror(errno));
  }

  // Remove oldroot directory (best effort)
  rmdir("/oldroot");

  log_line("[init] overlayfs setup complete - root is now copy-on-write");
  return true;
}

static void start_services(void) {
  // Minimal rootfs doesn't bring up loopback automatically, but we rely on 127.0.0.1
  // for the vsock->tcp bridge (socat) to reach the guest agent.
  log_line("[init] bringing up loopback");
  char *ip_lo_up[] = { (char *)"ip", (char *)"link", (char *)"set", (char *)"lo", (char *)"up", NULL };
  run_wait("/sbin/ip", ip_lo_up);
  char *ip_lo_addr[] = { (char *)"ip", (char *)"addr", (char *)"add", (char *)"127.0.0.1/8", (char *)"dev", (char *)"lo", NULL };
  // Ignore error if already assigned.
  run_wait("/sbin/ip", ip_lo_addr);

  log_line("[init] shell variant: %s", SHELL_VARIANT);
  setenv("JAIL_SHELL", SHELL_VARIANT, 1);

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

int main(void) {
  ensure_dir("/var", 0755);
  ensure_dir("/var/log", 0755);
  redirect_stdio_to_console();

  log_line("[init] pid=%d starting", (int)getpid());
  setenv("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", 1);

  // Mount essential filesystems first
  ensure_dir("/proc", 0555);
  ensure_dir("/sys", 0555);
  ensure_dir("/dev", 0755);
  if (mount("proc", "/proc", "proc", 0, NULL) != 0) log_line("mount /proc failed: %s", strerror(errno));
  if (mount("sysfs", "/sys", "sysfs", 0, NULL) != 0) log_line("mount /sys failed: %s", strerror(errno));
  if (mount("devtmpfs", "/dev", "devtmpfs", 0, NULL) != 0) log_line("mount /dev failed: %s", strerror(errno));

  // Check if we should use overlayfs mode (overlay device present)
  if (should_use_overlay()) {
    if (setup_overlay()) {
      // After pivot_root, we need to remount /proc, /sys, /dev in the new root
      // They were left behind in the old root
      log_line("[init] remounting virtual filesystems in new root");
      if (mount("proc", "/proc", "proc", 0, NULL) != 0) log_line("mount /proc failed: %s", strerror(errno));
      if (mount("sysfs", "/sys", "sysfs", 0, NULL) != 0) log_line("mount /sys failed: %s", strerror(errno));
      if (mount("devtmpfs", "/dev", "devtmpfs", 0, NULL) != 0) log_line("mount /dev failed: %s", strerror(errno));
    } else {
      log_line("[init] overlay setup failed, continuing with read-only root");
      // Try to remount root as read-write for legacy mode
      if (mount(NULL, "/", NULL, MS_REMOUNT, NULL) != 0) {
        log_line("[init] remount rw failed: %s (continuing anyway)", strerror(errno));
      }
    }
  } else {
    log_line("[init] no overlay device, using legacy mode (direct rootfs)");
    // Legacy mode: root is already mounted, just make sure it's writable
    // This handles backward compatibility when no overlay disk is provided
  }

  // Start services (guest-agent, socat)
  start_services();

  return 0;
}
