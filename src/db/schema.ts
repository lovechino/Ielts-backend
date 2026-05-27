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
  ai_persona: text('ai_persona').default('james'), // james, emily, dr_chen, sarah
  timezone: text('timezone').default('UTC'),
  current_streak: integer('current_streak').default(0),
  longest_streak: integer('longest_streak').default(0),
  last_active_date: text('last_active_date'),
  created_at: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  updated_at: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const oauthAccounts = sqliteTable('oauth_accounts', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  provider_id: text('provider_id').notNull(),
});

export const refreshTokens = sqliteTable('refresh_tokens', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token_hash: text('token_hash').notNull(),
  expires_at: timestamp('expires_at').notNull(),
  revoked_at: timestamp('revoked_at'),
  created_at: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
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
  speaking_part: integer('speaking_part'), // 1 | 2 | 3 (optional, for speaking skill mini tests)
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

export const vocabCourses = sqliteTable('vocab_courses', {
  id: uuid('id'),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  thumbnail_url: text('thumbnail_url'),
  structure_type: text('structure_type').default('cefr_levels').notNull(),
});

export const vocabulary = sqliteTable('vocabulary', {
  id: uuid('id'),
  vocab_course_id: text('vocab_course_id').references(() => vocabCourses.id, { onDelete: 'cascade' }),
  word: text('word').notNull().unique(),
  definition: text('definition'),
  definition_vi: text('definition_vi'),
  example: text('example'),
  example_vi: text('example_vi'),
  topic: text('topic'),
  pronunciation: text('pronunciation'),
  part_of_speech: text('part_of_speech'),
  synonyms: text('synonyms', { mode: 'json' }),
  antonyms: text('antonyms', { mode: 'json' }),
  level: text('level'),
});

export const courseEnrollments = sqliteTable('course_enrollments', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  course_id: text('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  status: text('status').default('enrolled'), // enrolled, completed, dropped
  enrolled_at: timestamp('enrolled_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => {
  return {
    userCourseUc: unique('_user_course_uc').on(table.user_id, table.course_id)
  }
});

export const speakingSessions = sqliteTable('speaking_sessions', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  persona_id: text('persona_id').notNull(), // 'james' | 'emily' | 'dr_chen' | 'sarah'
  topic: text('topic').notNull(),
  part: integer('part').notNull(),          // 1 | 2 | 3
  status: text('status').default('active'), // 'active' | 'completed'
  turn_count: integer('turn_count').default(0),
  average_band: real('average_band'),
  report: text('report', { mode: 'json' }), // SessionReport JSON
  started_at: timestamp('started_at').default(sql`CURRENT_TIMESTAMP`),
  ended_at: timestamp('ended_at'),
});

export const speakingTurns = sqliteTable('speaking_turns', {
  id: uuid('id'),
  session_id: text('session_id').notNull().references(() => speakingSessions.id, { onDelete: 'cascade' }),
  transcript: text('transcript'),
  ai_response: text('ai_response', { mode: 'json' }), // ExaminerFeedback
  band_estimate: real('band_estimate'),
  created_at: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const devicePushTokens = sqliteTable('device_push_tokens', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expo_push_token: text('expo_push_token').notNull(),
  platform: text('platform').notNull(),
  updated_at: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => {
  return {
    userExpoPushUc: unique('_user_expo_push_uc').on(table.user_id, table.expo_push_token)
  }
});

// Track vocabulary learning status per user (seen → learned → mastered)
export const userVocabProgress = sqliteTable('user_vocab_progress', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  vocab_id: text('vocab_id').notNull().references(() => vocabulary.id, { onDelete: 'cascade' }),
  status: text('status').default('seen'), // 'seen' | 'learned' | 'mastered'
  reviewed_at: timestamp('reviewed_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  userVocabUc: unique('_user_vocab_uc').on(table.user_id, table.vocab_id),
}));

// Track daily learning activity for streak calculation
export const dailyActivity = sqliteTable('daily_activity', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  activity_date: text('activity_date').notNull(), // YYYY-MM-DD in user's timezone
  source: text('source').default('mobile'),
  created_at: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  userDateUc: unique('_user_date_uc').on(table.user_id, table.activity_date),
}));


