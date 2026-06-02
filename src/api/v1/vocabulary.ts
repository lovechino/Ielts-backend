import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { sql } from 'drizzle-orm';
import { userVocabProgress } from '../../db/schema';
import { VocabularyService } from '../../services/vocabulary.service';
import type { Bindings } from '../../index';

const vocabRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

vocabRouter.get('/courses', async (c) => {
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const courses = await service.getCourses();
  return c.json({ success: true, data: courses });
});

vocabRouter.get('/', async (c) => {
  const level = c.req.query('level');
  const topic = c.req.query('topic');
  const vocab_course_id = c.req.query('vocab_course_id');
  const structure_type = c.req.query('structure_type');
  const limit = c.req.query('limit');
  const offset = c.req.query('offset');

  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const words = await service.getAll({
    level,
    topic,
    vocab_course_id,
    structure_type,
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
  const secret = c.env.JWT_SECRET || 'default-secret-key';
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
