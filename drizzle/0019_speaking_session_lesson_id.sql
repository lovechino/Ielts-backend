-- Migration 0019: Add lesson_id to speaking_sessions
-- Allows history to show lesson title instead of raw topic/cue card text
ALTER TABLE `speaking_sessions` ADD `lesson_id` text REFERENCES `lessons`(`id`);
