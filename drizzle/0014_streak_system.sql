ALTER TABLE users ADD COLUMN `timezone` text DEFAULT 'UTC';
ALTER TABLE users ADD COLUMN `current_streak` integer DEFAULT 0;
ALTER TABLE users ADD COLUMN `longest_streak` integer DEFAULT 0;
ALTER TABLE users ADD COLUMN `last_active_date` text;
--> statement-breakpoint
CREATE TABLE `daily_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`activity_date` text NOT NULL,
	`source` text DEFAULT 'mobile',
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `_user_date_uc` ON `daily_activity` (`user_id`, `activity_date`);
