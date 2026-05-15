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
ALTER TABLE `questions` ADD `group_id` text REFERENCES question_groups(id);--> statement-breakpoint
ALTER TABLE `lessons` DROP COLUMN `duration`;