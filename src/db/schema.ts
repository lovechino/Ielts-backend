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
  tier: text('tier').default('free'),       // 'free' | 'premium'
  target_band: real('target_band'),
  avatar_url: text('avatar_url'),
  avatar_frame: text('avatar_frame'),       // For Shop
  is_active: integer('is_active', { mode: 'boolean' }).default(true),
  ai_persona: text('ai_persona').default('james'), // james, emily, dr_chen, sarah
  timezone: text('timezone').default('UTC'),
  current_streak: integer('current_streak').default(0),
  longest_streak: integer('longest_streak').default(0),
  last_active_date: text('last_active_date'),
  gems: integer('gems').default(0),          // Hard currency
  coins: integer('coins').default(0),        // Soft currency
  xp: integer('xp').default(0),              // Experience points
  level: integer('level').default(1),        // User level
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

// --- Test Center Infrastructure (RESTORED) ---

export const courses = sqliteTable('courses', {
  id: uuid('id'),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  thumbnail_url: text('thumbnail_url'),
  level: text('level'), // A1, A2, B1, B2, C1, C2
  category: text('category').default('general'),
  order: integer('order').default(0),
  is_active: integer('is_active', { mode: 'boolean' }).default(true),
  created_at: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const courseEnrollments = sqliteTable('course_enrollments', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  course_id: text('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  status: text('status').default('enrolled'), // enrolled, completed, dropped
  enrolled_at: timestamp('enrolled_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  userCourseUc: unique('_user_course_uc').on(table.user_id, table.course_id)
}));

export const lessons = sqliteTable('lessons', {
  id: uuid('id'),
  course_id: text('course_id').references(() => courses.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content'), // Markdown
  order: integer('order').default(0),
  lesson_type: text('lesson_type'), // video, reading, listening, writing, speaking
  pdf_url: text('pdf_url'),
  time_limit: integer('time_limit').default(60), // in minutes
  is_test: integer('is_test', { mode: 'boolean' }).default(true), // Default to true now as we focus on tests
  test_type: text('test_type'), // mini, full, practice
  lesson_parts: text('lesson_parts', { mode: 'json' }), // [1,2,3]
  metadata: text('metadata', { mode: 'json' }),
});

export const passages = sqliteTable('passages', {
  id: uuid('id'),
  lesson_id: text('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
  title: text('title'),
  content_html: text('content_html'),
  order: integer('order').default(0),
  part: integer('part').default(1),       // IELTS part number (1, 2, or 3)
  audio_url: text('audio_url'),           // Audio file URL for Listening passages
  transcript: text('transcript'),          // Audio transcript for accessibility
  image_url: text('image_url'),           // For Writing Task 1 (chart/diagram)
  task_type: text('task_type'),           // 'chart' | 'diagram' | 'map' | 'process' | 'letter' | 'report'
});

export const questionGroups = sqliteTable('question_groups', {
  id: uuid('id'),
  passage_id: text('passage_id').references(() => passages.id, { onDelete: 'cascade' }),
  lesson_id: text('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
  title: text('title'),
  instruction: text('instruction'),
  group_type: text('group_type'),
  order: integer('order').default(0),
  part: integer('part').default(1),       // IELTS part number (1, 2, or 3)
  question_start: integer('question_start'), // e.g. 1, 14, 27
  question_end: integer('question_end'),     // e.g. 13, 26, 40
});

export const questions = sqliteTable('questions', {
  id: uuid('id'),
  lesson_id: text('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
  group_id: text('group_id').references(() => questionGroups.id, { onDelete: 'cascade' }),
  question_type: text('question_type').notNull(), // reading, listening, writing, speaking
  title: text('title'),
  content: text('content').notNull(),
  options: text('options', { mode: 'json' }),
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
  status: text('status').default('pending'),
  score: real('score'),
  feedback: text('feedback', { mode: 'json' }),
  raw_ai_response: text('raw_ai_response'),
});

export const userProgress = sqliteTable('user_progress', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lesson_id: text('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
  status: text('status').default('not_started'),
  score: real('score').default(0.0),
  total_questions: real('total_questions').default(0.0),
  correct_answers: real('correct_answers').default(0.0),
  draft_answers: text('draft_answers', { mode: 'json' }),
  time_left: integer('time_left'),
  scoring_status: text('scoring_status').default('none'),
  full_result_unlocked: integer('full_result_unlocked', { mode: 'boolean' }).default(false),
  preview_score: real('preview_score'),
  result_available_at: timestamp('result_available_at'),
  completed_at: timestamp('completed_at'),
  updated_at: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  userLessonUc: unique('_user_lesson_uc').on(table.user_id, table.lesson_id)
}));

// --- New Vocabulary & Practice Infrastructure ---

export const vocabCourses = sqliteTable('vocab_courses', {
  id: uuid('id'),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  thumbnail_url: text('thumbnail_url'),
  created_at: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const vocabulary = sqliteTable('vocabulary', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vocab_course_id: text('vocab_course_id').references(() => vocabCourses.id, { onDelete: 'set null' }),
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
  is_priority: integer('is_priority', { mode: 'boolean' }).default(false),
  is_academic: integer('is_academic', { mode: 'boolean' }).default(false),
});

export const userVocabProgress = sqliteTable('user_vocab_progress', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  vocab_id: integer('vocab_id').references(() => vocabulary.id, { onDelete: 'cascade' }),
  status: text('status').default('new'), // new, learning, learned, mastered
  reviewed_at: timestamp('reviewed_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  userVocabUc: unique('_user_vocab_uc').on(table.user_id, table.vocab_id)
}));

export const userWordVault = sqliteTable('user_word_vault', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  vocab_id: integer('vocab_id').references(() => vocabulary.id, { onDelete: 'cascade' }),
  custom_word: text('custom_word'),
  custom_definition: text('custom_definition'),
  personal_notes: text('personal_notes'),
  group_name: text('group_name').default('General'),
  status: text('status').default('new'),
  next_review_at: timestamp('next_review_at'),
  ease_factor: real('ease_factor').default(2.5),
  interval: integer('interval').default(0),
  created_at: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  updated_at: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const dailyChallenges = sqliteTable('daily_challenges', {
  id: uuid('id'),
  challenge_date: text('challenge_date').notNull().unique(), // YYYY-MM-DD
  topic: text('topic'),
  tasks: text('tasks', { mode: 'json' }),
  content: text('content', { mode: 'json' }),
  created_at: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const userChallengeCompletion = sqliteTable('user_challenge_completion', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  challenge_id: text('challenge_id').references(() => dailyChallenges.id, { onDelete: 'cascade' }),
  is_completed: integer('is_completed', { mode: 'boolean' }).default(false),
  reward_claimed: integer('reward_claimed', { mode: 'boolean' }).default(false),
  rewards_claimed: integer('rewards_claimed', { mode: 'boolean' }).default(false), // Alias for compat
  completed_at: timestamp('completed_at'),
}, (table) => ({
  userChallengeUc: unique('_user_challenge_uc').on(table.user_id, table.challenge_id),
}));

export const speakingSessions = sqliteTable('speaking_sessions', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lesson_id: text('lesson_id').references(() => lessons.id, { onDelete: 'set null' }),
  persona_id: text('persona_id').notNull(),
  topic: text('topic').notNull(),
  part: integer('part').notNull(),
  status: text('status').default('active'),
  turn_count: integer('turn_count').default(0),
  average_band: real('average_band'),
  report: text('report', { mode: 'json' }),
  report_available_at: timestamp('report_available_at'),
  report_unlocked: integer('report_unlocked', { mode: 'boolean' }).default(false),
  started_at: timestamp('started_at').default(sql`CURRENT_TIMESTAMP`),
  ended_at: timestamp('ended_at'),
});

export const speakingTurns = sqliteTable('speaking_turns', {
  id: uuid('id'),
  session_id: text('session_id').notNull().references(() => speakingSessions.id, { onDelete: 'cascade' }),
  transcript: text('transcript'),
  ai_response: text('ai_response', { mode: 'json' }),
  band_estimate: real('band_estimate'),
  created_at: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const devicePushTokens = sqliteTable('device_push_tokens', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expo_push_token: text('expo_push_token').notNull(),
  platform: text('platform').notNull(),
  updated_at: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  userExpoPushUc: unique('_user_expo_push_uc').on(table.user_id, table.expo_push_token)
}));

export const dailyActivity = sqliteTable('daily_activity', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  activity_date: text('activity_date').notNull(),
  source: text('source').default('mobile'),
  updated_at: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  }, (table) => ({
  userDateUc: unique('_user_date_uc').on(table.user_id, table.activity_date),
  }));

  export const transactions = sqliteTable('transactions', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  amount: real('amount').notNull(),         // Số tiền thực (VNĐ/USD) hoặc Gems
  currency: text('currency').default('VND'), // VND, USD, GEMS
  type: text('type').notNull(),             // 'topup', 'ad_reward', 'shop_purchase', 'subscription'
  provider: text('provider'),               // 'stripe', 'payos', 'google_play', 'ad_network'
  status: text('status').default('pending'), // 'pending', 'completed', 'failed'
  metadata: text('metadata', { mode: 'json' }), // { ad_unit_id: '...', stripe_session_id: '...' }
  created_at: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  });

  // --- Shop & Gamification Infrastructure ---


export const shopItems = sqliteTable('shop_items', {
  id: uuid('id'),
  name: text('name').notNull(),
  description: text('description'),
  item_type: text('item_type').notNull(), // avatar, frame, booster, protection
  sub_type: text('sub_type').default('static'), // static, animated
  rarity: text('rarity').default('common'), // common, rare, epic, legendary
  price_coins: integer('price_coins').default(0),
  price_gems: integer('price_gems').default(0),
  image_url: text('image_url'),
  metadata: text('metadata', { mode: 'json' }), // { effect: 'xp_boost', value: 2.0, duration_hours: 24 }
  is_active: integer('is_active', { mode: 'boolean' }).default(true),
  created_at: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const userInventory = sqliteTable('user_inventory', {
  id: uuid('id'),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  item_id: text('item_id').notNull().references(() => shopItems.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').default(1),
  is_equipped: integer('is_equipped', { mode: 'boolean' }).default(false),
  expires_at: timestamp('expires_at'),
  purchased_at: timestamp('purchased_at').default(sql`CURRENT_TIMESTAMP`),
  updated_at: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

