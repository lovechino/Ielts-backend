/**
 * Admin Stats — real-time system overview for Admin Dashboard
 * GET /api/v1/stats/admin-overview
 */
import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, sql, count } from 'drizzle-orm';
import { users, vocabulary, lessons, userProgress, speakingSessions, dailyChallenges } from '../../../db/schema';
import type { Bindings } from '../../../index';

const adminStatsRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

adminStatsRouter.use('/*', async (c, next) => {
  if (c.env.ENABLE_ADMIN !== 'true') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  return next();
});

adminStatsRouter.use('/*', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  return jwt({ secret, alg: 'HS256' })(c, next);
});

adminStatsRouter.use('/*', async (c, next) => {
  const payload = c.get('jwtPayload') as { sub: string; role?: string };
  if (payload.role !== 'admin') {
    const db = drizzle(c.env.DB);
    const user = await db.select({ role: users.role }).from(users).where(eq(users.id, payload.sub)).get();
    if (user?.role !== 'admin') {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
  }
  return next();
});

adminStatsRouter.get('/overview', async (c) => {
  const db = drizzle(c.env.DB);

  const [
    totalUsersRow,
    premiumUsersRow,
    totalWordsRow,
    totalLessonsRow,
    totalSubmissionsRow,
    totalSpeakingRow,
    todayChallengeRow,
  ] = await Promise.all([
    db.select({ count: count() }).from(users).get(),
    db.select({ count: count() }).from(users).where(eq(users.tier, 'premium')).get(),
    db.select({ count: count() }).from(vocabulary).get(),
    db.select({ count: count() }).from(lessons).get(),
    db.select({ count: count() }).from(userProgress).where(eq(userProgress.status, 'completed')).get(),
    db.select({ count: count() }).from(speakingSessions).where(eq(speakingSessions.status, 'completed')).get(),
    db.select({ id: dailyChallenges.id })
      .from(dailyChallenges)
      .where(eq(dailyChallenges.challenge_date, new Date().toISOString().slice(0, 10)))
      .get(),
  ]);

  return c.json({
    success: true,
    data: {
      total_users: totalUsersRow?.count ?? 0,
      premium_users: premiumUsersRow?.count ?? 0,
      total_words: totalWordsRow?.count ?? 0,
      total_lessons: totalLessonsRow?.count ?? 0,
      total_submissions: totalSubmissionsRow?.count ?? 0,
      total_speaking_sessions: totalSpeakingRow?.count ?? 0,
      today_challenge_exists: !!todayChallengeRow,
    },
  });
});

export default adminStatsRouter;
