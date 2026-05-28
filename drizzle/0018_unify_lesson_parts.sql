-- Migration 0018: Unify lesson_parts
-- Rename speaking_parts to lesson_parts and migrate writing tasks from metadata

-- 1. Rename column
ALTER TABLE `lessons` RENAME COLUMN `speaking_parts` TO `lesson_parts`;

-- 2. Data migration for Writing tasks (extract tasks array from metadata)
UPDATE `lessons` 
SET `lesson_parts` = json_extract(`metadata`, '$.tasks') 
WHERE `lesson_type` = 'writing' 
  AND `metadata` IS NOT NULL 
  AND json_extract(`metadata`, '$.tasks') IS NOT NULL;
