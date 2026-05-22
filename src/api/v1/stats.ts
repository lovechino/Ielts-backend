import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, inArray, sql, count, and } from 'drizzle-orm';
import { vocabulary, userVocabProgress, courseEnrollments, userProgress, lessons } from '../../db/schema';
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

  return courses.map(c => {
    const comp = completed.find(x => x.course_id === c.course_id)?.completed_lessons || 0;
    const progress_pct = c.total_lessons > 0 ? Math.round((comp / c.total_lessons) * 100) : 0;
    return { course_id: c.course_id, total_lessons: c.total_lessons, completed_lessons: comp, progress_pct };
  });
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

export default statsRouter;
