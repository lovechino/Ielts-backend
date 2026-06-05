-- Migration: Mixed Skill Parts Architecture
-- Adds `part`, `audio_url`, and `transcript` to `passages`
-- Adds `part` to `question_groups`
-- Existing rows default to part = 1 (backward compatible)

ALTER TABLE passages ADD COLUMN part INTEGER DEFAULT 1;
ALTER TABLE passages ADD COLUMN audio_url TEXT;
ALTER TABLE passages ADD COLUMN transcript TEXT;

ALTER TABLE question_groups ADD COLUMN part INTEGER DEFAULT 1;
