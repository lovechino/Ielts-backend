-- Migration: Add missing fields to daily_challenges
ALTER TABLE `daily_challenges` ADD COLUMN `topic` text;
ALTER TABLE `daily_challenges` ADD COLUMN `content` text;
