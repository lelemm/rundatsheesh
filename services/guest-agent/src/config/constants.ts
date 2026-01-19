export const USER_HOME = "/home/user";

// Dedicated chroot root for `/exec` so `/home/user` can exist as a normal directory inside the chroot.
// The guest-agent bind-mounts the real USER_HOME into `${SANDBOX_ROOT}/home/user` and `${SANDBOX_ROOT}/workspace`.
export const SANDBOX_ROOT = "/opt/sandbox";
