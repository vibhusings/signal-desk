CREATE TABLE `signal_events` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`company_key` text NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'New' NOT NULL,
	`first_seen` text NOT NULL,
	`last_seen` text NOT NULL,
	`run_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `signal_events_owner_company` ON `signal_events` (`owner_id`,`company_key`);--> statement-breakpoint
CREATE TABLE `signal_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`status` text NOT NULL,
	`criteria` text NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`result` text
);
--> statement-breakpoint
CREATE INDEX `signal_runs_owner_status` ON `signal_runs` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `signal_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	`next_scan_at` text
);
--> statement-breakpoint
CREATE TABLE `signal_sources` (
	`owner_id` text NOT NULL,
	`url` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `url`)
);
