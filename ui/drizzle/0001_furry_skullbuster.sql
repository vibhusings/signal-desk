CREATE TABLE `outreach_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`action` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outreach_runner` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`snapshot` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL
);
