CREATE TABLE `signal_observations` (
	`owner_id` text NOT NULL,
	`run_id` text NOT NULL,
	`url` text NOT NULL,
	`data` text NOT NULL,
	`observed_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `run_id`, `url`)
);
