ALTER TABLE `vocab_courses` ADD `status` text DEFAULT 'published';
--> statement-breakpoint
ALTER TABLE `vocab_courses` ADD `updated_at` integer;
--> statement-breakpoint
ALTER TABLE `vocab_courses` ADD `is_deleted` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `vocab_course_words` ADD `updated_at` integer;
--> statement-breakpoint
ALTER TABLE `vocab_course_words` ADD `is_deleted` integer DEFAULT 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vocab_courses_sync` ON `vocab_courses` (`updated_at`, `is_deleted`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vocab_course_words_sync` ON `vocab_course_words` (`updated_at`, `is_deleted`);
--> statement-breakpoint
UPDATE `vocab_courses` SET `updated_at` = strftime('%s', 'now') WHERE `updated_at` IS NULL;
--> statement-breakpoint
UPDATE `vocab_course_words` SET `updated_at` = strftime('%s', 'now') WHERE `updated_at` IS NULL;
