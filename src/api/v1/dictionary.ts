/**
 * Dictionary Version API — public endpoint, no auth required
 * GET /api/v1/dictionary/version
 *
 * Lưu metadata version trong KV với key "dictionary:version"
 * Admin set version qua: PUT /api/v1/dictionary/version (requires admin JWT)
 */
import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users } from '../../db/schema';
import type { Bindings } from '../../index';

const dictionaryRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

const KV_KEY = 'dictionary:version';

// ── GET /dictionary/version — public, no auth ─────────────────────────────────
dictionaryRouter.get('/version', async (c) => {
  try {
    const raw = await c.env.CACHE.get(KV_KEY);
    if (!raw) {
      // Fallback mặc định nếu chưa set
      return c.json({
        success: true,
        data: {
          version: '0.0.0',
          url: null,
          checksum: null,
          isFullUpdate: true,
          patchUrl: null,
          patchSize: null,
          updatedAt: null,
        },
      });
    }
    return c.json({ success: true, data: JSON.parse(raw) });
  } catch {
    return c.json({ success: false, error: 'Failed to fetch version' }, 500);
  }
});

// ── PUT /dictionary/version — admin only ──────────────────────────────────────
dictionaryRouter.put('/version', async (c, next) => {
  // Auth guard
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  return jwt({ secret, alg: 'HS256' })(c, next);
}, async (c, next) => {
  const payload = c.get('jwtPayload') as { sub: string; role?: string };
  if (payload.role !== 'admin') {
    const db = drizzle(c.env.DB);
    const user = await db.select({ role: users.role }).from(users).where(eq(users.id, payload.sub)).get();
    if (user?.role !== 'admin') {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
  }
  return next();
}, async (c) => {
  try {
    const body = await c.req.json() as {
      version: string;
      url: string;
      checksum?: string;
      isFullUpdate?: boolean;
      patchUrl?: string;
      patchSize?: number;
    };

    if (!body.version || !body.url) {
      return c.json({ success: false, error: 'version and url are required' }, 400);
    }

    const meta = {
      version: body.version,
      url: body.url,
      checksum: body.checksum ?? null,
      isFullUpdate: body.isFullUpdate ?? true,
      patchUrl: body.patchUrl ?? null,
      patchSize: body.patchSize ?? null,
      updatedAt: new Date().toISOString(),
    };

    // Cache 24h — app checks on startup
    await c.env.CACHE.put(KV_KEY, JSON.stringify(meta), { expirationTtl: 86400 });

    return c.json({ success: true, data: meta });
  } catch {
    return c.json({ success: false, error: 'Failed to update version' }, 500);
  }
});

export default dictionaryRouter;
