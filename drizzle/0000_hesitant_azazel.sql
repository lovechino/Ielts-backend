CREATE TABLE `daily_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`activity_date` text NOT NULL,
	`source` text DEFAULT 'mobile',
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `_user_date_uc` ON `daily_activity` (`user_id`,`activity_date`);--> statement-breakpoint
CREATE TABLE `daily_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge_date` text NOT NULL,
	`tasks` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_challenges_challenge_date_unique` ON `daily_challenges` (`challenge_date`);--> statement-breakpoint
CREATE TABLE `device_push_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expo_push_token` text NOT NULL,
	`platform` text NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `_user_expo_push_uc` ON `device_push_tokens` (`user_id`,`expo_push_token`);--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`order` integer DEFAULT 0,
	`lesson_type` text,
	`pdf_url` text,
	`time_limit` integer DEFAULT 60,
	`is_test` integer DEFAULT true,
	`test_type` text,
	`lesson_parts` text,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `oauth_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `passages` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`title` text,
	`content_html` text,
	`order` integer DEFAULT 0,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `question_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`passage_id` text,
	`lesson_id` text NOT NULL,
	`title` text,
	`instruction` text,
	`group_type` text,
	`order` integer DEFAULT 0,
	FOREIGN KEY (`passage_id`) REFERENCES `passages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`group_id` text,
	`question_type` text NOT NULL,
	`title` text,
	`content` text NOT NULL,
	`options` text,
	`correct_answer` text,
	`explanation` text,
	`points` integer DEFAULT 1,
	`image_url` text,
	`question_format` text DEFAULT 'MULTIPLE_CHOICE',
	`scoring_criteria` text,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `question_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `speaking_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`lesson_id` text,
	`persona_id` text NOT NULL,
	`topic` text NOT NULL,
	`part` integer NOT NULL,
	`status` text DEFAULT 'active',
	`turn_count` integer DEFAULT 0,
	`average_band` real,
	`report` text,
	`report_available_at` integer,
	`report_unlocked` integer DEFAULT false,
	`started_at` integer DEFAULT CURRENT_TIMESTAMP,
	`ended_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `speaking_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`transcript` text,
	`ai_response` text,
	`band_estimate` real,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`session_id`) REFERENCES `speaking_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`question_id` text NOT NULL,
	`answer_text` text NOT NULL,
	`status` text DEFAULT 'pending',
	`score` real,
	`feedback` text,
	`raw_ai_response` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_challenge_completion` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`challenge_id` text,
	`is_completed` integer DEFAULT false,
	`reward_claimed` integer DEFAULT false,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`challenge_id`) REFERENCES `daily_challenges`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `_user_challenge_uc` ON `user_challenge_completion` (`user_id`,`challenge_id`);--> statement-breakpoint
CREATE TABLE `user_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`status` text DEFAULT 'not_started',
	`score` real DEFAULT 0,
	`total_questions` real DEFAULT 0,
	`correct_answers` real DEFAULT 0,
	`draft_answers` text,
	`time_left` integer,
	`scoring_status` text DEFAULT 'none',
	`full_result_unlocked` integer DEFAULT false,
	`preview_score` real,
	`result_available_at` integer,
	`completed_at` integer,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `_user_lesson_uc` ON `user_progress` (`user_id`,`lesson_id`);--> statement-breakpoint
CREATE TABLE `user_word_vault` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`vocab_id` integer,
	`custom_word` text,
	`custom_definition` text,
	`personal_notes` text,
	`group_name` text DEFAULT 'General',
	`status` text DEFAULT 'new',
	`next_review_at` integer,
	`ease_factor` real DEFAULT 2.5,
	`interval` integer DEFAULT 0,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vocab_id`) REFERENCES `vocabulary`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`full_name` text NOT NULL,
	`role` text DEFAULT 'student',
	`tier` text DEFAULT 'free',
	`target_band` real,
	`avatar_url` text,
	`avatar_frame` text,
	`is_active` integer DEFAULT true,
	`ai_persona` text DEFAULT 'james',
	`timezone` text DEFAULT 'UTC',
	`current_streak` integer DEFAULT 0,
	`longest_streak` integer DEFAULT 0,
	`last_active_date` text,
	`gems` integer DEFAULT 0,
	`coins` integer DEFAULT 0,
	`xp` integer DEFAULT 0,
	`level` integer DEFAULT 1,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `vocabulary` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL,
	`definition` text,
	`definition_vi` text,
	`example` text,
	`example_vi` text,
	`topic` text,
	`pronunciation` text,
	`part_of_speech` text,
	`synonyms` text,
	`antonyms` text,
	`level` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vocabulary_word_unique` ON `vocabulary` (`word`);