CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`access_token` text NOT NULL,
	`token_expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`caption` text,
	`media_urls` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`status` text NOT NULL,
	`container_id` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
