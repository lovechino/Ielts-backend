-- Migration 0001: add missing tables

CREATE TABLE IF NOT EXISTS `courses` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `slug` text NOT NULL,
  `description` text,
  `thumbnail_url` text,
  `level` text,
  `category` text DEFAULT 'general',
  `order` integer DEFAULT 0,
  `is_active` integer DEFAULT true,
  `created_at` integer DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS `courses_slug_unique` ON `courses` (`slug`);

CREATE TABLE IF NOT EXISTS `course_enrollments` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `course_id` text NOT NULL,
  `status` text DEFAULT 'enrolled',
  `enrolled_at` integer DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade,
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS `_user_course_uc` ON `course_enrollments` (`user_id`,`course_id`);

CREATE TABLE IF NOT EXISTS `vocab_courses` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `slug` text NOT NULL,
  `description` text,
  `thumbnail_url` text,
  `created_at` integer DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS `vocab_courses_slug_unique` ON `vocab_courses` (`slug`);

CREATE TABLE IF NOT EXISTS `user_vocab_progress` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `vocab_id` integer,
  `status` text DEFAULT 'new',
  `reviewed_at` integer DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade,
  FOREIGN KEY (`vocab_id`) REFERENCES `vocabulary`(`id`) ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS `_user_vocab_uc` ON `user_vocab_progress` (`user_id`,`vocab_id`);

CREATE TABLE IF NOT EXISTS `shop_items` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `item_type` text NOT NULL,
  `price_coins` integer DEFAULT 0,
  `price_gems` integer DEFAULT 0,
  `image_url` text,
  `metadata` text,
  `is_active` integer DEFAULT true,
  `created_at` integer DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `user_inventory` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `item_id` text NOT NULL,
  `quantity` integer DEFAULT 1,
  `is_equipped` integer DEFAULT false,
  `expires_at` integer,
  `purchased_at` integer DEFAULT CURRENT_TIMESTAMP,
  `updated_at` integer DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `shop_items`(`id`) ON DELETE cascade
);
