CREATE TABLE IF NOT EXISTS `dictionary_releases` (
  `id` text PRIMARY KEY NOT NULL,
  `version` text NOT NULL,
  `word_count` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'draft',
  `notes` text,
  `checksum` text,
  `created_by` text,
  `created_at` integer DEFAULT CURRENT_TIMESTAMP,
  `published_at` integer,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `dictionary_releases_version_unique` ON `dictionary_releases` (`version`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_dictionary_releases_status` ON `dictionary_releases` (`status`, `published_at`);
