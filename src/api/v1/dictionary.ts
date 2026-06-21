/**
 * Dictionary Version API — public endpoint, no auth required
 * GET /api/v1/dictionary/version
 *
 * Lưu metadata version trong KV với key "dictionary:version"
 * Admin set version qua: PUT /api/v1/dictionary/version (requires admin JWT)
 */
import { Hono } from 'hono';
import { VocabularyService } from '../../services/vocabulary.service';
import type { Bindings, Variables } from '../../index';
import { adminGuard } from '../../middleware/auth';
import { writeAdminAuditLog } from '../../services/admin-audit.service';

const dictionaryRouter = new Hono<{ Bindings: Bindings, Variables: Variables }>({ strict: false });

const KV_KEY = 'dictionary:version';
const KV_PUB_KEY = 'vocab_db_version';

// ── GET /dictionary/version — public, no auth ─────────────────────────────────
dictionaryRouter.get('/version', async (c) => {
  try {
    const raw = await c.env.CACHE.get(KV_KEY);
    const pubVersion = await c.env.CACHE.get(KV_PUB_KEY);
    
    const baseMeta = raw ? JSON.parse(raw) : {
      version: '0.0.0',
      url: null,
      checksum: null,
      isFullUpdate: true,
      patchUrl: null,
      patchSize: null,
      updatedAt: null,
    };

    return c.json({ 
      success: true, 
      data: {
        ...baseMeta,
        current_version: pubVersion ? parseInt(pubVersion) : 0,
        full_db_url: baseMeta.url // Alias for migration plan compatibility
      } 
    });
  } catch {
    return c.json({ success: false, error: 'Failed to fetch version' }, 500);
  }
});

// ── GET /dictionary/sync — public, no auth ────────────────────────────────────
dictionaryRouter.get('/sync', async (c) => {
  const since = parseInt(c.req.query('since') || '0');
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  
  try {
    const deltas = await service.getSyncDeltas(since);
    return c.json({ success: true, data: deltas });
  } catch (e) {
    return c.json({ success: false, error: 'Sync failed' }, 500);
  }
});

// ── Admin Endpoints ───────────────────────────────────────────────────────────

dictionaryRouter.get('/admin/search', adminGuard, async (c) => {
  const q = c.req.query('q') || '';
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const results = await service.searchAdmin(q);
  return c.json({ success: true, data: results });
});

dictionaryRouter.patch('/admin/:id', adminGuard, async (c) => {
  const idParam = c.req.param('id');
  const id = idParam ? parseInt(idParam, 10) : NaN;
  if (!Number.isFinite(id)) {
    return c.json({ success: false, error: 'Invalid vocabulary id' }, 400);
  }

  const body = await c.req.json();
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const result = await service.updateVocabulary(id, body);
  await writeAdminAuditLog(c, 'dictionary.vocabulary_update', {
    targetType: 'vocabulary',
    targetId: id,
    metadata: { fields: Object.keys(body) },
  });
  return c.json({ success: true, data: result });
});

dictionaryRouter.post('/admin/publish', adminGuard, async (c) => {
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const { version } = await service.publishAll();
  
  // Update version in KV
  await c.env.CACHE.put(KV_PUB_KEY, version.toString());
  await writeAdminAuditLog(c, 'dictionary.publish', {
    targetType: 'dictionary',
    targetId: version,
  });
  
  return c.json({ success: true, data: { version } });
});

// ── PUT /dictionary/version — admin only (Old format) ─────────────────────────
dictionaryRouter.put('/version', adminGuard, async (c) => {
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
    await writeAdminAuditLog(c, 'dictionary.version_update', {
      targetType: 'dictionary_version',
      targetId: body.version,
      metadata: {
        url: body.url,
        checksum: body.checksum ?? null,
        isFullUpdate: body.isFullUpdate ?? true,
      },
    });

    return c.json({ success: true, data: meta });
  } catch {
    return c.json({ success: false, error: 'Failed to update version' }, 500);
  }
});

export default dictionaryRouter;
