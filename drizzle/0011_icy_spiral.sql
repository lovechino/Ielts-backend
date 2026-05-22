CREATE TABLE `vocab_courses` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`thumbnail_url` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vocab_courses_slug_unique` ON `vocab_courses` (`slug`);--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `vocab_course_id` text REFERENCES vocab_courses(id);