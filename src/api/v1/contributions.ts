/**
 * POST /api/v1/vault/contribute
 * Nhận batch từ vựng đóng góp từ user, kiểm tra duplicate + rate limit,
 * tặng xu ngay, enqueue job tự động duyệt nền.
 *
 * GET /api/v1/vault/contributions (Admin only)
 * Lấy danh sách đóng góp chờ duyệt.
 *
 * PATCH /api/v1/vault/contributions/:id (Admin only)
 * Duyệt hoặc từ chối đóng góp.
 */
import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, sql, inArray } from 'drizzle-orm';
import { vocabContributions, vocabulary, users, transactions } from '../../db/schema';
import type { Bindings } from '../../index';
import { requireJwtSecret } from '../../middleware/auth';

const contributionsRouter = new Hono<{ Bindings: Bindings }>();

// ── Auth middleware ──────────────────────────────────────────────────────────
contributionsRouter.use('/*', async (c, next) => {
  const secret = requireJwtSecret(c);
  return jwt({ secret, alg: 'HS256' })(c, next);
});

// ── Constants ────────────────────────────────────────────────────────────────
const REWARD_SUBMIT = 5;      // Xu khi từ được nhận vào hàng chờ
const REWARD_AUTO_APPROVE = 20; // Xu bonus khi auto-approved
const REWARD_ADMIN_APPROVE = 50; // Xu bonus khi admin duyệt
const REWARD_PIONEER = 100;   // Bonus người đầu tiên (chưa có trong hệ thống)
const MAX_WORDS_PER_REQUEST = 5;
const MAX_WORDS_PER_DAY = 10;

// ── Helper: Ghi transaction xu ───────────────────────────────────────────────
async function grantCoins(
  db: ReturnType<typeof drizzle>,
  userId: string,
  amount: number,
  type: string,
  metadata: object
) {
  // Dùng batch để đảm bảo atomic: cộng xu + ghi transaction cùng lúc
  await db.batch([
    db.update(users)
      .set({ coins: sql`${users.coins} + ${amount}` })
      .where(eq(users.id, userId)),
    db.insert(transactions).values({
      id: crypto.randomUUID(),
      user_id: userId,
      amount: amount,
      currency: 'COINS',
      type: type,
      status: 'completed',
      metadata: metadata as any,
    }),
  ] as any);
}

// ── Helper: Auto-score từ vựng ───────────────────────────────────────────────
function autoScoreWord(word: {
  word: string;
  phonetic?: string | null;
  definition?: string | null;
  definition_vi?: string | null;
  example?: string | null;
}): { score: number; status: 'approved' | 'needs_review' } {
  let score = 0;

  // Từ hợp lệ: chỉ chứa chữ cái, dấu gạch ngang, khoảng trắng (cho phrasal verbs)
  if (/^[a-zA-Z\s\-']+$/.test(word.word.trim())) score += 30;
  if (word.phonetic && word.phonetic.length > 2) score += 20;
  if (word.definition && word.definition.length > 10) score += 20;
  if (word.definition_vi && word.definition_vi.length > 3) score += 20;
  if (word.example && word.example.length > 10) score += 10;

  return {
    score,
    status: score >= 70 ? 'approved' : 'needs_review',
  };
}

// ── POST /vault/contribute ───────────────────────────────────────────────────
contributionsRouter.post('/contribute', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;
  const db = drizzle(c.env.DB);

  const body = await c.req.json().catch(() => ({})) as { words?: any[] };
  const rawWords: any[] = body.words || [];

  if (!Array.isArray(rawWords) || rawWords.length === 0) {
    return c.json({ success: false, error: 'words array is required' }, 400);
  }

  // Giới hạn max 5 từ / request
  const wordsToProcess = rawWords.slice(0, MAX_WORDS_PER_REQUEST);

  // ── Rate limit: Kiểm tra số từ đã nộp hôm nay ──
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTs = Math.floor(todayStart.getTime() / 1000);

  const todayCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(vocabContributions)
    .where(and(eq(vocabContributions.user_id, userId), gte(vocabContributions.created_at, new Date(todayTs * 1000))))
    .get();

  const alreadySubmitted = todayCount?.count || 0;
  const canSubmit = MAX_WORDS_PER_DAY - alreadySubmitted;

  if (canSubmit <= 0) {
    return c.json({
      success: false,
      error: { code: 'DAILY_LIMIT_REACHED', message: `Bạn đã đóng góp ${MAX_WORDS_PER_DAY} từ hôm nay. Hãy quay lại ngày mai!` }
    }, 429);
  }

  const batchToProcess = wordsToProcess.slice(0, canSubmit);
  const results: { word: string; status: string; coins_earned: number }[] = [];
  let totalCoinsEarned = 0;

  for (const item of batchToProcess) {
    const wordStr = (item.word || '').trim().toLowerCase();
    if (!wordStr || wordStr.length < 2) {
      results.push({ word: wordStr, status: 'invalid', coins_earned: 0 });
      continue;
    }

    try {
      // ── Kiểm tra duplicate trong vocabulary chính ──
      const existing = await db
        .select({ id: vocabulary.id })
        .from(vocabulary)
        .where(eq(vocabulary.word, wordStr))
        .get();

      if (existing) {
        results.push({ word: wordStr, status: 'duplicate', coins_earned: 0 });
        continue;
      }

      // ── Kiểm tra user đã từng nộp từ này chưa ──
      const alreadyContributed = await db
        .select({ id: vocabContributions.id })
        .from(vocabContributions)
        .where(and(eq(vocabContributions.user_id, userId), eq(vocabContributions.word, wordStr)))
        .get();

      if (alreadyContributed) {
        results.push({ word: wordStr, status: 'already_contributed', coins_earned: 0 });
        continue;
      }

      // ── Auto-score ──
      const { score, status: autoStatus } = autoScoreWord({
        word: wordStr,
        phonetic: item.phonetic,
        definition: item.definition,
        definition_vi: item.definition_vi,
        example: item.example,
      });

      // ── Insert vào vocab_contributions ──
      const contribId = crypto.randomUUID();
      await db.insert(vocabContributions).values({
        id: contribId,
        user_id: userId,
        word: wordStr,
        phonetic: item.phonetic || null,
        part_of_speech: item.part_of_speech || null,
        definition: item.definition || null,
        definition_vi: item.definition_vi || null,
        example: item.example || null,
        example_vi: item.example_vi || null,
        source: item.source || 'user',
        status: 'pending',
        auto_score: score,
        reward_paid: REWARD_SUBMIT,
      }).execute();

      // ── Tặng xu submit ngay ──
      await grantCoins(db, userId, REWARD_SUBMIT, 'vocab_contribution', {
        contribution_id: contribId,
        word: wordStr,
        event: 'submitted',
      });
      totalCoinsEarned += REWARD_SUBMIT;

      // ── Enqueue auto-review job (chạy nền, không chặn response) ──
      if (c.env.SCORING_QUEUE) {
        c.executionCtx.waitUntil(
          c.env.SCORING_QUEUE.send({
            type: 'vocab_contribution_review',
            contribution_id: contribId,
            user_id: userId,
            word: wordStr,
            auto_score: score,
            auto_status: autoStatus,
          })
        );
      }

      results.push({ word: wordStr, status: 'accepted', coins_earned: REWARD_SUBMIT });

    } catch (err: any) {
      console.error(`[Contribute] Error processing word "${wordStr}":`, err);
      results.push({ word: wordStr, status: 'error', coins_earned: 0 });
    }
  }

  return c.json({
    success: true,
    data: {
      results,
      total_coins_earned: totalCoinsEarned,
      daily_remaining: Math.max(0, canSubmit - batchToProcess.length),
    }
  });
});

// ── GET /vault/contributions (Admin) ─────────────────────────────────────────
contributionsRouter.get('/contributions', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string; role?: string };
  const db = drizzle(c.env.DB);

  // Check admin role
  const user = await db.select({ role: users.role }).from(users).where(eq(users.id, payload.sub)).get();
  if (user?.role !== 'admin') {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }

  const status = c.req.query('status') || 'pending';
  const page = parseInt(c.req.query('page') || '1');
  const perPage = parseInt(c.req.query('per_page') || '20');
  const offset = (page - 1) * perPage;

  const validStatuses = ['pending', 'approved', 'rejected', 'needs_review', 'duplicate'];
  const filterStatus = validStatuses.includes(status) ? status : 'pending';

  const [items, totalResult] = await Promise.all([
    db.select({
      id: vocabContributions.id,
      user_id: vocabContributions.user_id,
      word: vocabContributions.word,
      phonetic: vocabContributions.phonetic,
      definition: vocabContributions.definition,
      definition_vi: vocabContributions.definition_vi,
      example: vocabContributions.example,
      source: vocabContributions.source,
      status: vocabContributions.status,
      auto_score: vocabContributions.auto_score,
      reward_paid: vocabContributions.reward_paid,
      created_at: vocabContributions.created_at,
    })
      .from(vocabContributions)
      .where(eq(vocabContributions.status, filterStatus))
      .orderBy(vocabContributions.created_at)
      .limit(perPage)
      .offset(offset)
      .all(),
    db.select({ count: sql<number>`count(*)` })
      .from(vocabContributions)
      .where(eq(vocabContributions.status, filterStatus))
      .get(),
  ]);

  return c.json({
    success: true,
    data: items,
    meta: { page, per_page: perPage, total: totalResult?.count || 0 }
  });
});

// ── PATCH /vault/contributions/:id (Admin: approve/reject) ───────────────────
contributionsRouter.patch('/contributions/:id', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string; role?: string };
  const db = drizzle(c.env.DB);

  // Check admin role
  const adminUser = await db.select({ role: users.role }).from(users).where(eq(users.id, payload.sub)).get();
  if (adminUser?.role !== 'admin') {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }

  const contribId = c.req.param('id');
  const body = await c.req.json() as { action: 'approve' | 'reject'; note?: string };

  if (!['approve', 'reject'].includes(body.action)) {
    return c.json({ success: false, error: 'action must be "approve" or "reject"' }, 400);
  }

  const contrib = await db.select().from(vocabContributions).where(eq(vocabContributions.id, contribId)).get();
  if (!contrib) return c.json({ success: false, error: 'Not found' }, 404);
  if (contrib.status !== 'pending' && contrib.status !== 'needs_review') {
    return c.json({ success: false, error: 'Contribution already reviewed' }, 409);
  }

  if (body.action === 'approve') {
    // ── Check nếu từ đã tồn tại trong vocabulary ──
    const existingVocab = await db
      .select({ id: vocabulary.id })
      .from(vocabulary)
      .where(eq(vocabulary.word, contrib.word))
      .get();

    const isPioneer = !existingVocab;

    if (isPioneer) {
      // Merge vào vocabulary chính
      await db.insert(vocabulary).values({
        word: contrib.word,
        pronunciation: contrib.phonetic || '',
        part_of_speech: contrib.part_of_speech || '',
        definition: contrib.definition || '',
        definition_vi: contrib.definition_vi || '',
        example: contrib.example || '',
        example_vi: contrib.example_vi || '',
        topic: 'Contributed',
        status: 'published',
        updated_at: Math.floor(Date.now() / 1000),
      }).onConflictDoNothing().execute();
    }

    // Cập nhật status contribution
    await db.update(vocabContributions).set({
      status: 'approved',
      reviewed_by: payload.sub,
      reviewed_at: new Date(),
      admin_note: body.note || null,
    }).where(eq(vocabContributions.id, contribId)).execute();

    // Tặng xu bonus
    const bonusCoins = REWARD_ADMIN_APPROVE + (isPioneer ? REWARD_PIONEER : 0);
    await grantCoins(db, contrib.user_id, bonusCoins, 'vocab_contribution_approved', {
      contribution_id: contribId,
      word: contrib.word,
      event: isPioneer ? 'admin_approved_pioneer' : 'admin_approved',
    });

    return c.json({
      success: true,
      data: { approved: true, pioneer: isPioneer, coins_granted: bonusCoins }
    });

  } else {
    // Reject
    await db.update(vocabContributions).set({
      status: 'rejected',
      reviewed_by: payload.sub,
      reviewed_at: new Date(),
      admin_note: body.note || null,
    }).where(eq(vocabContributions.id, contribId)).execute();

    return c.json({ success: true, data: { rejected: true } });
  }
});

export default contributionsRouter;
