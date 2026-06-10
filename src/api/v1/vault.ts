/**
 * Word Vault Sync API — Premium users only
 *
 * POST /api/v1/vault/sync   — push local vault → server (upsert)
 * GET  /api/v1/vault        — pull server vault → mobile
 */
import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, inArray } from 'drizzle-orm';
import { users, userWordVault } from '../../db/schema';
import type { Bindings } from '../../index';

const vaultRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

// Auth middleware
vaultRouter.use('/*', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  return jwt({ secret, alg: 'HS256' })(c, next);
});

interface VaultItem {
  vocab_id: number;
  status: string;
  group_name?: string;
  ease_factor?: number;
  interval?: number;
  next_review_at?: number | null;
  updated_at?: number;
}

// POST /vault/sync — mobile pushes its local vault, server upserts
vaultRouter.post('/sync', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;
  const db = drizzle(c.env.DB);

  const { items } = await c.req.json() as { items: VaultItem[] };
  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ success: true, data: { synced: 0 } });
  }

  let synced = 0;
  for (const item of items) {
    if (!item.vocab_id) continue;

    const existing = await db.select({ id: userWordVault.id })
      .from(userWordVault)
      .where(and(eq(userWordVault.user_id, userId), eq(userWordVault.vocab_id, item.vocab_id)))
      .get();

    const nextReviewAt = item.next_review_at
      ? new Date(item.next_review_at * 1000)
      : null;

    if (existing) {
      await db.update(userWordVault)
        .set({
          status: item.status ?? 'new',
          group_name: item.group_name ?? 'General',
          ease_factor: item.ease_factor ?? 2.5,
          interval: item.interval ?? 0,
          next_review_at: nextReviewAt,
          updated_at: new Date(),
        })
        .where(eq(userWordVault.id, existing.id))
        .run();
    } else {
      await db.insert(userWordVault).values({
        id: crypto.randomUUID(),
        user_id: userId,
        vocab_id: item.vocab_id,
        status: item.status ?? 'new',
        group_name: item.group_name ?? 'General',
        ease_factor: item.ease_factor ?? 2.5,
        interval: item.interval ?? 0,
        next_review_at: nextReviewAt,
        created_at: new Date(),
        updated_at: new Date(),
      }).run();
    }
    synced++;
  }

  return c.json({ success: true, data: { synced } });
});

// GET /vault — pull server vault for mobile restore
vaultRouter.get('/', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;
  const db = drizzle(c.env.DB);

  const items = await db.select()
    .from(userWordVault)
    .where(eq(userWordVault.user_id, userId))
    .all();

  // Normalize timestamps to unix seconds for mobile
  const normalized = items.map(item => ({
    vocab_id: item.vocab_id,
    status: item.status,
    group_name: item.group_name,
    ease_factor: item.ease_factor,
    interval: item.interval,
    next_review_at: item.next_review_at
      ? Math.floor(new Date(item.next_review_at).getTime() / 1000)
      : null,
    updated_at: item.updated_at
      ? Math.floor(new Date(item.updated_at).getTime() / 1000)
      : null,
  }));

  return c.json({ success: true, data: normalized });
});

export default vaultRouter;
