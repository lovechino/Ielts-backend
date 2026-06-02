import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, inArray, sql, count, and, desc } from 'drizzle-orm';
import { vocabulary, userVocabProgress, courseEnrollments, userProgress, lessons, users, speakingSessions } from '../../db/schema';
import { StreakService } from '../../services/streak.service';
import type { Bindings } from '../../index';

const statsRouter = new Hono<{ Bindings: Bindings }>();

statsRouter.use('/*', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  return jwt({ secret, alg: 'HS256' })(c, next);
});

// Helper 1: Fetch total vocabulary count (< 20 lines)
async function fetchTotalVocab(db: ReturnType<typeof drizzle>): Promise<number> {
  const res = await db.select({ value: count() }).from(vocabulary).get();
  return res?.value || 0;
}

// Helper 2: Fetch vocabulary learned count (< 20 lines)
async function fetchVocabLearned(db: ReturnType<typeof drizzle>, userId: string): Promise<number> {
  const res = await db.select({ value: count() })
    .from(userVocabProgress)
    .where(and(
      eq(userVocabProgress.user_id, userId),
      inArray(userVocabProgress.status, ['learned', 'mastered'])
    ))
    .get();
  return res?.value || 0;
}

// Helper 3: Fetch course progress stats (< 20 lines)
async function fetchCourseProgressStats(db: ReturnType<typeof drizzle>, userId: string) {
  const courses = await db.select({
    course_id: courseEnrollments.course_id,
    total_lessons: sql<number>`count(${lessons.id})`,
  })
  .from(courseEnrollments)
  .innerJoin(lessons, eq(lessons.course_id, courseEnrollments.course_id))
  .where(eq(courseEnrollments.user_id, userId))
  .groupBy(courseEnrollments.course_id).all();

  const completed = await db.select({
    course_id: lessons.course_id,
    completed_lessons: sql<number>`count(${userProgress.id})`,
  })
  .from(userProgress)
  .innerJoin(lessons, eq(lessons.id, userProgress.lesson_id))
  .where(and(eq(userProgress.user_id, userId), eq(userProgress.status, 'completed')))
  .groupBy(lessons.course_id).all();

  const speakingComp = await db.select({ value: count() })
    .from(speakingSessions)
    .where(and(eq(speakingSessions.user_id, userId), eq(speakingSessions.status, 'completed')))
    .get();

  const courseStats = courses.map(c => {
    const comp = completed.find(x => x.course_id === c.course_id)?.completed_lessons || 0;
    const progress_pct = c.total_lessons > 0 ? Math.round((comp / c.total_lessons) * 100) : 0;
    return { course_id: c.course_id, total_lessons: c.total_lessons, completed_lessons: comp, progress_pct };
  });

  // Add dummy course for Speaking if there are sessions
  if (speakingComp && speakingComp.value > 0) {
    courseStats.push({
      course_id: 'speaking-practice',
      total_lessons: speakingComp.value,
      completed_lessons: speakingComp.value,
      progress_pct: 100
    });
  }

  return courseStats;
}

// Helper 4: Compute overall progress pct (< 20 lines)
function computeOverallPct(courseStats: any[]): number {
  let totalLessons = 0;
  let totalCompleted = 0;
  for (const c of courseStats) {
    totalLessons += c.total_lessons;
    totalCompleted += c.completed_lessons;
  }
  return totalLessons > 0 ? Math.round((totalCompleted / totalLessons) * 100) : 0;
}

// Route: GET /api/v1/stats/dashboard (< 20 lines)
statsRouter.get('/dashboard', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;
  const db = drizzle(c.env.DB);

  const [total_vocab, vocab_learned, courses] = await Promise.all([
    fetchTotalVocab(db),
    fetchVocabLearned(db, userId),
    fetchCourseProgressStats(db, userId),
  ]);

  const overall_progress_pct = computeOverallPct(courses);

  return c.json({
    success: true,
    data: { total_vocab, vocab_learned, overall_progress_pct, courses },
  });
});

// Route: POST /api/v1/stats/activity - Record daily learning activity
statsRouter.post('/activity', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;
  const db = drizzle(c.env.DB);
  const body = (await c.req.json().catch(() => ({}))) as { timezone?: string };

  const service = new StreakService(c.env.DB);
  const streak = await service.recordActivity(userId, body.timezone);

  return c.json({ success: true, data: streak });
});

// Route: GET /api/v1/stats/streak - Get user streak data
statsRouter.get('/streak', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;

  const service = new StreakService(c.env.DB);
  const streak = await service.getStreak(userId);

  return c.json({ success: true, data: streak });
});

// Route: POST /api/v1/stats/rewards - Update user coins and XP from games
statsRouter.post('/rewards', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;
  const db = drizzle(c.env.DB);
  const body = (await c.req.json().catch(() => ({}))) as { xp: number; coins: number };

  if (typeof body.xp !== 'number' || typeof body.coins !== 'number') {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'XP and Coins must be numbers' } }, 422);
  }

  // Update user stats with atomic increment
  const result = await db.update(users)
    .set({
      xp: sql`${users.xp} + ${body.xp}`,
      coins: sql`${users.coins} + ${body.coins}`,
      updated_at: sql`(strftime('%s', 'now'))`
    })
    .where(eq(users.id, userId))
    .returning({
      new_xp: users.xp,
      new_coins: users.coins,
      level: users.level
    })
    .get();

  return c.json({ success: true, data: result });
});

// ─── Leaderboard helpers ──────────────────────────────────────────────────────

const LEADERBOARD_CACHE_TTL = 300; // 5 phút

async function getCachedOrFetch<T>(
  cache: KVNamespace,
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = await cache.get(key);
  if (cached) return JSON.parse(cached) as T;
  const data = await fetcher();
  await cache.put(key, JSON.stringify(data), { expirationTtl: LEADERBOARD_CACHE_TTL });
  return data;
}

// Route: GET /api/v1/stats/leaderboard/streak
// Top 20 users theo current_streak
statsRouter.get('/leaderboard/streak', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const myId = payload.sub;
  const db = drizzle(c.env.DB);

  const rows = await getCachedOrFetch(c.env.CACHE, 'lb:streak', async () => {
    return db
      .select({
        user_id: users.id,
        full_name: users.full_name,
        avatar_url: users.avatar_url,
        current_streak: users.current_streak,
        longest_streak: users.longest_streak,
      })
      .from(users)
      .where(eq(users.is_active, true as any))
      .orderBy(desc(users.current_streak))
      .limit(20)
      .all();
  });

  // Tìm rank của user hiện tại (nếu không nằm trong top 20)
  const myRank = rows.findIndex((r) => r.user_id === myId);

  return c.json({
    success: true,
    data: {
      type: 'streak',
      entries: rows.map((r, i) => ({
        rank: i + 1,
        user_id: r.user_id,
        full_name: r.full_name,
        avatar_url: r.avatar_url,
        value: r.current_streak ?? 0,
        longest: r.longest_streak ?? 0,
        is_me: r.user_id === myId,
      })),
      my_rank: myRank >= 0 ? myRank + 1 : null,
    },
  });
});

// Route: GET /api/v1/stats/leaderboard/lessons
// Top 20 users theo số lessons đã hoàn thành
statsRouter.get('/leaderboard/lessons', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const myId = payload.sub;
  const db = drizzle(c.env.DB);

  const rows = await getCachedOrFetch(c.env.CACHE, 'lb:lessons', async () => {
    return db
      .select({
        user_id: userProgress.user_id,
        full_name: users.full_name,
        avatar_url: users.avatar_url,
        completed_count: sql<number>`count(${userProgress.id})`,
      })
      .from(userProgress)
      .innerJoin(users, eq(users.id, userProgress.user_id))
      .where(and(
        eq(userProgress.status, 'completed'),
        eq(users.is_active, true as any),
      ))
      .groupBy(userProgress.user_id, users.full_name, users.avatar_url)
      .orderBy(desc(sql`count(${userProgress.id})`))
      .limit(20)
      .all();
  });

  const myRank = rows.findIndex((r) => r.user_id === myId);

  return c.json({
    success: true,
    data: {
      type: 'lessons',
      entries: rows.map((r, i) => ({
        rank: i + 1,
        user_id: r.user_id,
        full_name: r.full_name,
        avatar_url: r.avatar_url,
        value: r.completed_count ?? 0,
        is_me: r.user_id === myId,
      })),
      my_rank: myRank >= 0 ? myRank + 1 : null,
    },
  });
});

// Route: GET /api/v1/stats/leaderboard/vocab
// Top 20 users theo số từ vựng đã mastered
statsRouter.get('/leaderboard/vocab', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const myId = payload.sub;
  const db = drizzle(c.env.DB);

  const rows = await getCachedOrFetch(c.env.CACHE, 'lb:vocab', async () => {
    return db
      .select({
        user_id: userVocabProgress.user_id,
        full_name: users.full_name,
        avatar_url: users.avatar_url,
        mastered_count: sql<number>`count(${userVocabProgress.id})`,
      })
      .from(userVocabProgress)
      .innerJoin(users, eq(users.id, userVocabProgress.user_id))
      .where(and(
        eq(userVocabProgress.status, 'mastered'),
        eq(users.is_active, true as any),
      ))
      .groupBy(userVocabProgress.user_id, users.full_name, users.avatar_url)
      .orderBy(desc(sql`count(${userVocabProgress.id})`))
      .limit(20)
      .all();
  });

  const myRank = rows.findIndex((r) => r.user_id === myId);

  return c.json({
    success: true,
    data: {
      type: 'vocab',
      entries: rows.map((r, i) => ({
        rank: i + 1,
        user_id: r.user_id,
        full_name: r.full_name,
        avatar_url: r.avatar_url,
        value: r.mastered_count ?? 0,
        is_me: r.user_id === myId,
      })),
      my_rank: myRank >= 0 ? myRank + 1 : null,
    },
  });
});

export default statsRouter;
