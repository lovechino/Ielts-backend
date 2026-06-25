CREATE TABLE IF NOT EXISTS `vocab_course_words` (
  `id` text PRIMARY KEY NOT NULL,
  `course_id` text NOT NULL,
  `vocab_id` integer NOT NULL,
  `order_index` integer NOT NULL DEFAULT 0,
  `section` text,
  `is_featured` integer DEFAULT 0,
  `created_at` integer DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`course_id`) REFERENCES `vocab_courses`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`vocab_id`) REFERENCES `vocabulary`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `vocab_course_words_course_vocab_unique` ON `vocab_course_words` (`course_id`, `vocab_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vocab_course_words_course` ON `vocab_course_words` (`course_id`, `order_index`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vocab_course_words_vocab` ON `vocab_course_words` (`vocab_id`);
