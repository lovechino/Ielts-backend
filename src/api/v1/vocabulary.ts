import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { sql } from 'drizzle-orm';
import { userVocabProgress, userUnlockedBundles } from '../../db/schema';
import { VocabularyService } from '../../services/vocabulary.service';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../../index';
import { requireJwtSecret } from '../../middleware/auth';

const vocabRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

// GET /api/v1/vocabulary/bundles/my — Lấy danh sách bundle đã mở khóa
vocabRouter.get('/bundles/my', async (c, next) => {
  const secret = requireJwtSecret(c);
  return jwt({ secret, alg: 'HS256' })(c, next);
}, async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const db = drizzle(c.env.DB);
  
  const unlocked = await db.select({ bundle_id: userUnlockedBundles.bundle_id })
    .from(userUnlockedBundles)
    .where(eq(userUnlockedBundles.user_id, payload.sub))
    .all();
    
  return c.json({ success: true, data: unlocked.map(u => u.bundle_id) });
});

// POST /api/v1/vocabulary/bundles/unlock — Mở khóa bundle
vocabRouter.post('/bundles/unlock', async (c, next) => {
  const secret = requireJwtSecret(c);
  return jwt({ secret, alg: 'HS256' })(c, next);
}, async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const { bundle_id } = await c.req.json();
  const db = drizzle(c.env.DB);

  if (!bundle_id) return c.json({ success: false, error: 'bundle_id required' }, 400);

  await db.insert(userUnlockedBundles)
    .values({ 
      id: crypto.randomUUID(), 
      user_id: payload.sub, 
      bundle_id 
    })
    .onConflictDoNothing();

  return c.json({ success: true });
});

vocabRouter.get('/paths', async (c) => {
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const courses = await service.getCourses();
  return c.json({ success: true, data: courses });
});

vocabRouter.get('/paths/:id/words', async (c) => {
  const courseId = c.req.param('id');
  const limit = c.req.query('limit');
  const offset = c.req.query('offset');
  const mode = c.req.query('mode') === 'ids' ? 'ids' : 'full';
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const words = await service.getCourseWords(courseId, {
    mode,
    limit: limit ? parseInt(limit) : undefined,
    offset: offset ? parseInt(offset) : undefined,
  });
  return c.json({ success: true, data: words });
});

vocabRouter.get('/', async (c) => {
  const level = c.req.query('level');
  const topic = c.req.query('topic');
  const vocab_course_id = c.req.query('vocab_course_id');
  const structure_type = c.req.query('structure_type');
  const is_priority = c.req.query('is_priority');
  const is_academic = c.req.query('is_academic');
  const limit = c.req.query('limit');
  const offset = c.req.query('offset');

  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const words = await service.getAll({
    level,
    topic,
    vocab_course_id,
    structure_type,
    is_priority: is_priority === 'true' ? true : is_priority === 'false' ? false : undefined,
    is_academic: is_academic === 'true' ? true : is_academic === 'false' ? false : undefined,
    limit: limit ? parseInt(limit) : undefined,
    offset: offset ? parseInt(offset) : undefined
  });

  return c.json({ success: true, data: words });
});

vocabRouter.get('/:word', async (c) => {
  const word = c.req.param('word');
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const data = await service.getByWord(word);

  if (!data) {
    return c.json({ success: false, error: { message: 'Word not found' } }, 404);
  }
  return c.json({ success: true, data });
});

vocabRouter.patch('/:id/progress', async (c, next) => {
  const secret = requireJwtSecret(c);
  return jwt({ secret, alg: 'HS256' })(c, next);
}, async (c) => {
  const vocab_id = c.req.param('id');
  const { status } = await c.req.json();
  const payload = c.get('jwtPayload') as { sub: string };
  const db = drizzle(c.env.DB);

  await db.insert(userVocabProgress)
    .values({ user_id: payload.sub, vocab_id: Number(vocab_id), status })
    .onConflictDoUpdate({
      target: [userVocabProgress.user_id, userVocabProgress.vocab_id],
      set: { status, reviewed_at: sql`CURRENT_TIMESTAMP` }
    });

  return c.json({ success: true });
});

export default vocabRouter;
