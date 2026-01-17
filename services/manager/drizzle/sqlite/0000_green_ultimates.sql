CREATE TABLE `vms` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`cpu` integer NOT NULL,
	`mem_mb` integer NOT NULL,
	`guest_ip` text NOT NULL,
	`tap_name` text NOT NULL,
	`vsock_cid` integer NOT NULL,
	`outbound_internet` integer NOT NULL,
	`allow_ips` text NOT NULL,
	`rootfs_path` text NOT NULL,
	`kernel_path` text NOT NULL,
	`logs_dir` text NOT NULL,
	`created_at` text NOT NULL,
	`provision_mode` text
);
