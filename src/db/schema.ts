import { sqliteTable, text, integer, real, blob, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Common helper for UUID primary keys
const uuid = (name: string) => text(name).primaryKey().$defaultFn(() => crypto.randomUUID());
const timestamp = (name: string) => integer(name, { mode: 'timestamp' });

export const users = sqliteTable('users', {
  id: uuid('id'),
  email: text('email').notNull().unique(),
  password_hash: text('password_hash'),
  full_name: text('full_name').notNull(),
  role: text('role').default('student'),
  target_band: real('target_band'),
  avatar_url: text('avatar_url'),
  is_active: integer('is_active', { mode: 'boolean' }).default(true),
  created_at: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  updated_at: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const oauthAccounts = sqliteTable('oauth_accounts', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  provider_id: text('provider_id').notNull(),
});

export const courses = sqliteTable('courses', {
  id: uuid('id'),
  title: text('title').notNull(),
  description: text('description'),
  level: text('level').default('beginner'), // beginner, intermediate, advanced
  thumbnail_url: text('thumbnail_url'),
  price: real('price').default(0.0),
});

export const lessons = sqliteTable('lessons', {
  id: uuid('id'),
  course_id: text('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content'), // Markdown
  order: integer('order').default(0),
  lesson_type: text('lesson_type'), // video, reading, listening, writing, speaking
  pdf_url: text('pdf_url'),
  time_limit: integer('time_limit').default(60), // in minutes
  is_test: integer('is_test', { mode: 'boolean' }).default(false),
  test_type: text('test_type'), // mini, full, practice
});

export const passages = sqliteTable('passages', {
  id: uuid('id'),
  lesson_id: text('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
  title: text('title'),
  content_html: text('content_html'), // HTML or Markdown
  order: integer('order').default(0),
});

export const questionGroups = sqliteTable('question_groups', {
  id: uuid('id'),
  passage_id: text('passage_id').references(() => passages.id, { onDelete: 'cascade' }),
  lesson_id: text('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
  title: text('title'), // e.g., "Questions 1-5"
  instruction: text('instruction'), // e.g., "Do the following statements agree with the information given..."
  group_type: text('group_type'), // e.g., "TRUE_FALSE_NOT_GIVEN"
  order: integer('order').default(0),
});

export const questions = sqliteTable('questions', {
  id: uuid('id'),
  lesson_id: text('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
  group_id: text('group_id').references(() => questionGroups.id, { onDelete: 'cascade' }),
  question_type: text('question_type').notNull(), // reading, listening, writing, speaking
  title: text('title'),
  content: text('content').notNull(),
  options: text('options', { mode: 'json' }), // JSON string for Multiple Choice
  correct_answer: text('correct_answer'),
  explanation: text('explanation'),
  points: integer('points').default(1),
  image_url: text('image_url'),
  question_format: text('question_format').default('MULTIPLE_CHOICE'),
  scoring_criteria: text('scoring_criteria'),
});

export const submissions = sqliteTable('submissions', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  question_id: text('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
  answer_text: text('answer_text').notNull(),
  status: text('status').default('pending'), // pending, scoring, completed, failed
  score: real('score'),
  feedback: text('feedback', { mode: 'json' }),
  raw_ai_response: text('raw_ai_response'),
});

export const userProgress = sqliteTable('user_progress', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lesson_id: text('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
  status: text('status').default('not_started'), // not_started, in_progress, completed
  score: real('score').default(0.0),
  total_questions: real('total_questions').default(0.0),
  correct_answers: real('correct_answers').default(0.0),
  draft_answers: text('draft_answers', { mode: 'json' }), // Store selectedAnswers JSON
  time_left: integer('time_left'), // Remaining seconds
  completed_at: timestamp('completed_at'),
  updated_at: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => {
  return {
    userLessonUc: unique('_user_lesson_uc').on(table.user_id, table.lesson_id)
  }
});

export const vocabulary = sqliteTable('vocabulary', {
  id: uuid('id'),
  word: text('word').notNull().unique(),
  definition: text('definition'),
  example: text('example'),
  topic: text('topic'),
  pronunciation: text('pronunciation'),
  synonyms: text('synonyms', { mode: 'json' }),
  antonyms: text('antonyms', { mode: 'json' }),
  level: text('level'),
});
