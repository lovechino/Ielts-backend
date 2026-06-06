-- Migration to add reward_claimed to progress and sessions
ALTER TABLE `user_progress` ADD COLUMN `reward_claimed` integer DEFAULT 0;
ALTER TABLE `speaking_sessions` ADD COLUMN `reward_claimed` integer DEFAULT 0;
