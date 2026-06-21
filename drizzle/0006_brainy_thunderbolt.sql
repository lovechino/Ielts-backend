CREATE TABLE `vocab_contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`word` text NOT NULL,
	`phonetic` text,
	`part_of_speech` text,
	`definition` text,
	`definition_vi` text,
	`example` text,
	`example_vi` text,
	`source` text DEFAULT 'user',
	`status` text DEFAULT 'pending',
	`reward_paid` integer DEFAULT 0,
	`auto_score` integer,
	`admin_note` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `_contrib_user_word_uc` ON `vocab_contributions` (`user_id`,`word`);