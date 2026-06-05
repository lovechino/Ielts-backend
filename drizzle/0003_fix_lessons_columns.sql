-- Migration: Add missing columns to lessons table
-- These columns exist in schema.ts but were missing from the initial local DB setup

ALTER TABLE lessons ADD COLUMN course_id TEXT REFERENCES courses(id) ON DELETE CASCADE;
ALTER TABLE lessons ADD COLUMN speaking_part INTEGER;
