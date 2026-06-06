ALTER TABLE `daily_activity` ADD `created_at` integer DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `user_progress` ADD `reward_claimed` integer DEFAULT false;