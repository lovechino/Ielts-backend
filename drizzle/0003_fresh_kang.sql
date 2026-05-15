ALTER TABLE `lessons` ADD `time_limit` integer DEFAULT 60;--> statement-breakpoint
ALTER TABLE `user_progress` ADD `draft_answers` text;--> statement-breakpoint
ALTER TABLE `user_progress` ADD `time_left` integer;