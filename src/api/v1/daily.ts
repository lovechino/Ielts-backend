import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, sql } from 'drizzle-orm';
import { dailyChallenges, userChallengeCompletion, users } from '../../db/schema';
import type { Bindings } from '../../index';

import { ChallengeService } from '../../services/challenge.service';

const dailyRouter = new Hono<{ Bindings: Bindings }>();

// Auth middleware
dailyRouter.use('/*', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  return jwt({ secret, alg: 'HS256' })(c, next);
});

// GET /api/v1/daily/today - Get today's challenge with personalized tasks
dailyRouter.get('/today', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;
  
  const challengeService = new ChallengeService(c.env.DB);
  const db = drizzle(c.env.DB);

  try {
    // 1. Lấy hoặc tạo challenge chung cho ngày hôm nay
    const challenge = await challengeService.getOrCreateDailyChallenge(userId);

    // 2. Lấy các task cá nhân hóa (SRS)
    const personalized = await challengeService.getUserPersonalizedTasks(userId);

    // 3. Kiểm tra trạng thái hoàn thành
    const completion = await db.select()
      .from(userChallengeCompletion)
      .where(and(
        eq(userChallengeCompletion.user_id, userId),
        eq(userChallengeCompletion.challenge_id, (challenge as any).id)
      ))
      .get();

    return c.json({
      success: true,
      data: {
        ...challenge,
        personalized,
        is_completed: !!completion?.is_completed,
        reward_claimed: !!completion?.reward_claimed
      }
    });
  } catch (err: any) {
    console.error('[Daily] getToday error:', err?.message);
    // Trả về empty challenge thay vì 500 — app vẫn hoạt động bình thường
    return c.json({
      success: true,
      data: {
        id: null,
        challenge_date: new Date().toISOString().split('T')[0],
        tasks: {
          vocab_ids: [],
          reading_id: null,
          listening_id: null,
          pronunciation_word: null,
        },
        personalized: { review_vocab_ids: [] },
        is_completed: false,
        reward_claimed: false,
      }
    });
  }
});

// POST /api/v1/daily/complete - Mark challenge as completed
dailyRouter.post('/complete', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;
  const db = drizzle(c.env.DB);
  const { challenge_id } = await c.req.json();

  if (!challenge_id) return c.json({ success: false, message: 'Missing challenge_id' }, 422);

  // Atomic update or insert
  await db.insert(userChallengeCompletion)
    .values({
      user_id: userId,
      challenge_id,
      is_completed: true,
      completed_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [userChallengeCompletion.user_id, userChallengeCompletion.challenge_id],
      set: { is_completed: true, completed_at: new Date() }
    })
    .run();

  return c.json({ success: true, message: 'Challenge completed' });
});

// POST /api/v1/daily/claim - Claim rewards for challenge
dailyRouter.post('/claim', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;
  const db = drizzle(c.env.DB);
  const { challenge_id } = await c.req.json();

  const completion = await db.select()
    .from(userChallengeCompletion)
    .where(and(
      eq(userChallengeCompletion.user_id, userId),
      eq(userChallengeCompletion.challenge_id, challenge_id)
    ))
    .get();

  if (!completion || !completion.is_completed) {
    return c.json({ success: false, message: 'Challenge not completed yet' }, 400);
  }

  if (completion.reward_claimed) {
    return c.json({ success: false, message: 'Rewards already claimed' }, 400);
  }

  // Transaction: Update completion + add rewards to user
  await db.batch([
    db.update(userChallengeCompletion)
      .set({ reward_claimed: true })
      .where(and(
        eq(userChallengeCompletion.user_id, userId),
        eq(userChallengeCompletion.challenge_id, challenge_id)
      )),
    db.update(users)
      .set({
        coins: sql`${users.coins} + 50`,
        xp: sql`${users.xp} + 100`
      })
      .where(eq(users.id, userId))
  ]);

  return c.json({ success: true, message: 'Rewards claimed: +100 XP, +50 Coins' });
});

export default dailyRouter;
