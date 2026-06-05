ALTER TABLE `passages` ADD `part` integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE `passages` ADD `audio_url` text;--> statement-breakpoint
ALTER TABLE `passages` ADD `transcript` text;--> statement-breakpoint
ALTER TABLE `passages` ADD `image_url` text;--> statement-breakpoint
ALTER TABLE `passages` ADD `task_type` text;--> statement-breakpoint
ALTER TABLE `question_groups` ADD `part` integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE `question_groups` ADD `question_start` integer;--> statement-breakpoint
ALTER TABLE `question_groups` ADD `question_end` integer;