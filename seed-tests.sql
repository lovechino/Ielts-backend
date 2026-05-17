-- Mock Test Data for IELTS Platform

-- 1. Mini Test (Reading)
INSERT INTO lessons (id, course_id, title, content, "order", lesson_type, pdf_url, time_limit, is_test, test_type) 
VALUES ('lesson-mini-reading-1', '51ab6c3b-cb47-4729-9d92-8749dac4f244', 'Reading Mini Test 1', 'Practice your reading skills with this mini test.', 1, 'reading', NULL, 15, 1, 'mini');

INSERT INTO passages (id, lesson_id, title, content_html, "order")
VALUES ('passage-1', 'lesson-mini-reading-1', 'The History of Chocolate', '<p>Chocolate has a long and fascinating history dating back thousands of years. The ancient Maya and Aztec civilizations in Mesoamerica cultivated cacao trees and used the beans to create a bitter, frothy drink. It was highly valued and even used as currency.</p><p>When the Spanish arrived in the Americas, they brought chocolate back to Europe, where it was sweetened with sugar and became a luxury item for the wealthy.</p>', 1);

INSERT INTO question_groups (id, passage_id, lesson_id, title, instruction, group_type, "order")
VALUES ('group-1', 'passage-1', 'lesson-mini-reading-1', 'Questions 1-3', 'Do the following statements agree with the information given in the passage? Choose TRUE, FALSE or NOT GIVEN.', 'TRUE_FALSE_NOT_GIVEN', 1);

INSERT INTO questions (id, lesson_id, group_id, question_type, title, content, options, correct_answer, explanation, points, question_format)
VALUES 
('q-1', 'lesson-mini-reading-1', 'group-1', 'reading', 'Question 1', 'Chocolate originated in Europe.', '["TRUE", "FALSE", "NOT GIVEN"]', 'FALSE', 'The passage states that it originated in Mesoamerica with the Maya and Aztec civilizations.', 1, 'MULTIPLE_CHOICE'),
('q-2', 'lesson-mini-reading-1', 'group-1', 'reading', 'Question 2', 'Cacao beans were used as currency by ancient civilizations.', '["TRUE", "FALSE", "NOT GIVEN"]', 'TRUE', 'The text explicitly says "It was highly valued and even used as currency."', 1, 'MULTIPLE_CHOICE'),
('q-3', 'lesson-mini-reading-1', 'group-1', 'reading', 'Question 3', 'The Spanish were the first to add milk to chocolate.', '["TRUE", "FALSE", "NOT GIVEN"]', 'NOT GIVEN', 'The passage mentions the Spanish sweetened it with sugar, but does not mention milk.', 1, 'MULTIPLE_CHOICE');


-- 2. Full Test (Listening)
INSERT INTO lessons (id, course_id, title, content, "order", lesson_type, pdf_url, time_limit, is_test, test_type) 
VALUES ('lesson-full-listen-1', '2c2c44f8-53af-437e-b2c5-f776f69714d5', 'Listening Full Practice 1', 'A complete listening test simulation.', 1, 'listening', NULL, 40, 1, 'full');

INSERT INTO question_groups (id, passage_id, lesson_id, title, instruction, group_type, "order")
VALUES ('group-2', NULL, 'lesson-full-listen-1', 'Questions 1-2', 'Listen to the audio and answer the multiple choice questions.', 'MULTIPLE_CHOICE', 1);

INSERT INTO questions (id, lesson_id, group_id, question_type, title, content, options, correct_answer, explanation, points, question_format)
VALUES 
('q-4', 'lesson-full-listen-1', 'group-2', 'listening', 'Question 1', 'What is the main topic of the lecture?', '["A) Climate Change", "B) Ocean Currents", "C) Marine Biology"]', 'A) Climate Change', 'The speaker introduces the topic as the changing climate.', 1, 'MULTIPLE_CHOICE'),
('q-5', 'lesson-full-listen-1', 'group-2', 'listening', 'Question 2', 'When is the assignment due?', '["A) Monday", "B) Wednesday", "C) Friday"]', 'C) Friday', 'The professor clearly states the deadline is this coming Friday.', 1, 'MULTIPLE_CHOICE');

-- 3. Mini Test (Writing)
INSERT INTO lessons (id, course_id, title, content, "order", lesson_type, pdf_url, time_limit, is_test, test_type) 
VALUES ('lesson-mini-writing-1', '4de8d772-8f28-4b2b-8f8b-67dfce9f01a6', 'Writing Task 2 Practice', 'Practice your essay writing.', 1, 'writing', NULL, 40, 1, 'mini');

INSERT INTO questions (id, lesson_id, group_id, question_type, title, content, options, correct_answer, explanation, points, question_format)
VALUES 
('q-6', 'lesson-mini-writing-1', NULL, 'writing', 'Writing Task 2', 'Some people think that universities should provide graduates with the knowledge and skills needed in the workplace. Others think that the true function of a university should be to give access to knowledge for its own sake, regardless of whether the course is useful to an employer. Discuss both these views and give your own opinion.', NULL, NULL, NULL, 9, 'ESSAY');
