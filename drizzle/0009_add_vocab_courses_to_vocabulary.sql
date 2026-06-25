CREATE TABLE IF NOT EXISTS `vocab_courses` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `slug` text NOT NULL,
  `description` text,
  `thumbnail_url` text,
  `created_at` integer DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `vocab_courses_slug_unique` ON `vocab_courses` (`slug`);
--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `vocab_course_id` text REFERENCES `vocab_courses`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vocabulary_course` ON `vocabulary` (`vocab_course_id`);
