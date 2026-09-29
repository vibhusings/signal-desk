CREATE TABLE IF NOT EXISTS `crm_contacts` (
	`owner_id` text NOT NULL,
	`email` text NOT NULL,
	`relationship` text DEFAULT 'Contact' NOT NULL,
	PRIMARY KEY(`owner_id`, `email`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `crm_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`result` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `crm_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`next_scan_at` text,
	`next_attio_at` text,
	`webhook_hash` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `crm_sources` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	`analysis` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crm_one_job ON crm_jobs(owner_id,kind) WHERE status IN ('queued','running') AND kind IN ('inbox','attio');
