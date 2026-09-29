CREATE TABLE `runner_credentials` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`key_id` text NOT NULL,
	`ciphertext` text NOT NULL,
	`updated_at` text NOT NULL
);
