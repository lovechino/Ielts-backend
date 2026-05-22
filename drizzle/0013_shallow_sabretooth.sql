CREATE TABLE `user_vocab_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`vocab_id` text NOT NULL,
	`status` text DEFAULT 'seen',
	`reviewed_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vocab_id`) REFERENCES `vocabulary`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `_user_vocab_uc` ON `user_vocab_progress` (`user_id`,`vocab_id`);