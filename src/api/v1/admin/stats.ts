/**
 * Admin Stats — real-time system overview for Admin Dashboard
 * GET /api/v1/stats/admin-overview
 */
import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { desc, eq, sql, count, and, inArray } from 'drizzle-orm';
import { users, vocabulary, lessons, userProgress, speakingSessions, dailyChallenges, transactions, dictionaryReleases } from '../../../db/schema';
import type { Bindings, Variables } from '../../../index';
import { adminGuard } from '../../../middleware/auth';

const adminStatsRouter = new Hono<{ Bindings: Bindings, Variables: Variables }>({ strict: false });

adminStatsRouter.use('/*', adminGuard);

adminStatsRouter.get('/overview', async (c) => {
  const db = drizzle(c.env.DB);
  const today = new Date().toISOString().slice(0, 10);
  const dictionaryTargetWords = Number(c.env.DICTIONARY_TARGET_WORDS || 450000);

  const [
    totalUsersRow,
    premiumUsersRow,
    totalWordsRow,
    publishedWordsRow,
    latestReleaseRow,
    totalLessonsRow,
    totalSubmissionsRow,
    totalSpeakingRow,
    todayChallengeRow,
    // BI Metrics
    todayRevenueRow,
    totalTopupRow,
    adViewsRow,
  ] = await Promise.all([
    db.select({ count: count() }).from(users).get(),
    db.select({ count: count() }).from(users).where(eq(users.tier, 'premium')).get(),
    db.select({ count: count() }).from(vocabulary).get(),
    db.select({ count: count() }).from(vocabulary).where(and(eq(vocabulary.status, 'published'), eq(vocabulary.is_deleted, 0))).get(),
    db.select().from(dictionaryReleases).where(eq(dictionaryReleases.status, 'published')).orderBy(desc(dictionaryReleases.published_at)).limit(1).get(),
    db.select({ count: count() }).from(lessons).get(),
    db.select({ count: count() }).from(userProgress).where(eq(userProgress.status, 'completed')).get(),
    db.select({ count: count() }).from(speakingSessions).where(eq(speakingSessions.status, 'completed')).get(),
    db.select({ id: dailyChallenges.id })
      .from(dailyChallenges)
      .where(eq(dailyChallenges.challenge_date, today))
      .get(),
    // BI: Revenue today
    db.select({ total: sql`SUM(${transactions.amount})` })
      .from(transactions)
      .where(and(
        eq(transactions.status, 'completed'),
        sql`date(${transactions.created_at}) = ${today}`,
        inArray(transactions.type, ['topup', 'subscription'])
      ))
      .get(),
    // BI: Lifetime Revenue
    db.select({ total: sql`SUM(${transactions.amount})` })
      .from(transactions)
      .where(and(
        eq(transactions.status, 'completed'),
        inArray(transactions.type, ['topup', 'subscription'])
      ))
      .get(),
    // BI: Ad views today
    db.select({ count: count() })
      .from(transactions)
      .where(and(
        eq(transactions.type, 'ad_reward'),
        sql`date(${transactions.created_at}) = ${today}`
      ))
      .get(),
  ]);

  const totalWords = totalWordsRow?.count ?? 0;

  return c.json({
    success: true,
    data: {
      total_users: totalUsersRow?.count ?? 0,
      premium_users: premiumUsersRow?.count ?? 0,
      total_words: totalWords,
      published_words: publishedWordsRow?.count ?? 0,
      dictionary_words: Math.max(totalWords, dictionaryTargetWords),
      dictionary_target_words: dictionaryTargetWords,
      latest_dictionary_version: latestReleaseRow?.version ?? null,
      latest_dictionary_word_count: latestReleaseRow?.word_count ?? null,
      total_lessons: totalLessonsRow?.count ?? 0,
      total_submissions: totalSubmissionsRow?.count ?? 0,
      total_speaking_sessions: totalSpeakingRow?.count ?? 0,
      today_challenge_exists: !!todayChallengeRow,
      // BI fields
      today_revenue: Number((todayRevenueRow as any)?.total || 0),
      total_revenue: Number((totalTopupRow as any)?.total || 0),
      today_ad_views: adViewsRow?.count ?? 0,
      environment: c.env.ENABLE_ADMIN === 'true' ? 'production' : 'local',
      is_local: !c.env.ENABLE_ADMIN || c.env.ENABLE_ADMIN !== 'true',
    },
  });
});

export default adminStatsRouter;
