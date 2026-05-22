import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users } from '../../../db/schema';
import { VocabularyService } from '../../../services/vocabulary.service';
import type { Bindings } from '../../../index';

const adminVocabRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

adminVocabRouter.use('/*', async (c, next) => {
  if (c.env.ENABLE_ADMIN !== 'true') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  return next();
});

adminVocabRouter.use('/*', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  const jwtMiddleware = jwt({ secret, alg: 'HS256' });
  return jwtMiddleware(c, next);
});

adminVocabRouter.use('/*', async (c, next) => {
  const payload = c.get('jwtPayload') as { sub: string; role?: string };
  if (payload.role !== 'admin') {
    const db = drizzle(c.env.DB);
    const user = await db.select({ role: users.role }).from(users).where(eq(users.id, payload.sub)).get();
    if (user?.role !== 'admin') {
      return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
    }
  }
  return next();
});

adminVocabRouter.post('/courses', async (c) => {
  const body = await c.req.json();
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const course = await service.createCourse(body);
  return c.json({ success: true, data: course });
});

adminVocabRouter.put('/courses/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const course = await service.updateCourse(id, body);
  return c.json({ success: true, data: course });
});

adminVocabRouter.delete('/courses/:id', async (c) => {
  const id = c.req.param('id');
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const result = await service.deleteCourse(id);
  return c.json(result);
});

adminVocabRouter.post('/bulk-import', async (c) => {
  const { vocab_course_id, words } = await c.req.json();
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const result = await service.bulkImportVocabulary(vocab_course_id, words);
  return c.json({ success: true, data: result });
});

adminVocabRouter.post('/', async (c) => {
  const body = await c.req.json();
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const word = await service.upsertVocabulary(body);
  return c.json({ success: true, data: word });
});

adminVocabRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const result = await service.deleteVocabulary(id);
  return c.json(result);
});

export default adminVocabRouter;
