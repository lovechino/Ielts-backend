-- Migration 0016: Deferred scoring system
-- Thêm các cột mới cho free/premium tier và deferred scoring

-- 1. users: thêm tier
ALTER TABLE users ADD COLUMN tier TEXT DEFAULT 'free';

-- 2. user_progress: thêm deferred scoring fields
ALTER TABLE user_progress ADD COLUMN scoring_status TEXT DEFAULT 'none';
ALTER TABLE user_progress ADD COLUMN full_result_unlocked INTEGER DEFAULT 0;
ALTER TABLE user_progress ADD COLUMN preview_score REAL;
ALTER TABLE user_progress ADD COLUMN result_available_at INTEGER;

-- 3. speaking_sessions: thêm deferred report fields
ALTER TABLE speaking_sessions ADD COLUMN report_available_at INTEGER;
ALTER TABLE speaking_sessions ADD COLUMN report_unlocked INTEGER DEFAULT 0;
