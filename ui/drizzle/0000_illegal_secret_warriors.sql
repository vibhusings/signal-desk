CREATE TABLE `companies` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
