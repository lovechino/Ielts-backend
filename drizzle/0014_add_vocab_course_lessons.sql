-- Migration: Add vocab_course_lessons table and lesson_id to vocab_course_words
-- This enables admin courses to have structured lessons (not just flat section text)

CREATE TABLE IF NOT EXISTS vocab_course_lessons (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES vocab_courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_vocab_course_lessons_course
  ON vocab_course_lessons(course_id, order_index);

CREATE INDEX IF NOT EXISTS idx_vocab_course_lessons_sync
  ON vocab_course_lessons(updated_at, is_deleted);

-- Add lesson_id to vocab_course_words (nullable for backward compat)
ALTER TABLE vocab_course_words ADD COLUMN lesson_id TEXT REFERENCES vocab_course_lessons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vocab_course_words_lesson
  ON vocab_course_words(lesson_id, order_index);
