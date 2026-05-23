-- Seed data for local development
-- Run: wrangler d1 execute DB --file=seed-dev.sql

-- Create an admin user (password: admin123, bcrypt hash)
INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, timezone)
VALUES ('admin-001', 'admin@ielts.local', '$2b$10$W8ntz7RxIfFz8d1xWB5RI.YaHUd8Nk3GcoCulkTI2HRKgHLwn0tpS', 'Admin User', 'admin', 'Asia/Ho_Chi_Minh');

-- Create a test student user (password: test123)
INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, timezone)
VALUES ('student-001', 'student@ielts.local', '$2a$10$8KzQMGx5C5Kc5Q5y5Q5z5u5Q5y5Q5z5u5Q5y5Q5z5u5Q5y5Q5z5u', 'Test Student', 'student', 'Asia/Ho_Chi_Minh');

-- Sample courses
INSERT OR IGNORE INTO courses (id, title, description, level)
VALUES ('course-001', 'IELTS Foundation', 'Basic course for IELTS beginners', 'beginner');
INSERT OR IGNORE INTO courses (id, title, description, level)
VALUES ('course-002', 'IELTS Advanced', 'Advanced course targeting band 7.0+', 'advanced');

-- Sample vocabulary course
INSERT OR IGNORE INTO vocab_courses (id, title, slug, description, structure_type)
VALUES ('vocab-course-001', 'Essential Words', 'essential-words', 'Core IELTS vocabulary', 'cefr_levels');

-- Sample vocabulary words
INSERT OR IGNORE INTO vocabulary (id, vocab_course_id, word, definition, definition_vi, topic, level, part_of_speech)
VALUES ('vocab-001', 'vocab-course-001', 'abandon', 'to leave completely and finally', 'từ bỏ', 'General', 'A2', 'verb');
INSERT OR IGNORE INTO vocabulary (id, vocab_course_id, word, definition, definition_vi, topic, level, part_of_speech)
VALUES ('vocab-002', 'vocab-course-001', 'beneficial', 'producing good results', 'có lợi', 'General', 'B1', 'adjective');
INSERT OR IGNORE INTO vocabulary (id, vocab_course_id, word, definition, definition_vi, topic, level, part_of_speech)
VALUES ('vocab-003', 'vocab-course-001', 'comprehensive', 'including everything', 'toàn diện', 'General', 'B2', 'adjective');
