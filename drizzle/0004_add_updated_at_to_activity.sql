-- Migration to add updated_at to daily_activity
ALTER TABLE `daily_activity` ADD COLUMN `updated_at` integer DEFAULT CURRENT_TIMESTAMP;
