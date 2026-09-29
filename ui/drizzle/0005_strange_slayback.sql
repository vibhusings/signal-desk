CREATE TABLE `runner_slashy` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`key_id` text NOT NULL,
	`ciphertext` text NOT NULL,
	`client_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slashy_oauth_client` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slashy_oauth_pending` (
	`state` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`code_verifier` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` text NOT NULL
);
