-- Migration to add reward_claimed to sessions
ALTER TABLE `speaking_sessions` ADD COLUMN `reward_claimed` integer DEFAULT 0;
