CREATE TABLE `user_unlocked_bundles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bundle_id` text NOT NULL,
	`unlocked_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `_user_bundle_uc` ON `user_unlocked_bundles` (`user_id`,`bundle_id`);--> statement-breakpoint
ALTER TABLE `speaking_sessions` ADD `reward_claimed` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `speaking_turns` ADD `silence_metadata` text;--> statement-breakpoint
ALTER TABLE `user_progress` ADD `attempt_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `users` ADD `has_completed_assessment` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `status` text DEFAULT 'published';--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `updated_at` integer DEFAULT (strftime('%s', 'now'));--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `is_deleted` integer DEFAULT 0;