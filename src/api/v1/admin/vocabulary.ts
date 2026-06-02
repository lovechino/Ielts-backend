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

// GET /vocabulary/export-sql — xuất toàn bộ vocabulary thành SQL INSERT statements
// để admin đóng gói vào dictionary.db
adminVocabRouter.get('/export-sql', async (c) => {
  const vocab_course_id = c.req.query('vocab_course_id');
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const words = await service.getAll({ vocab_course_id: vocab_course_id || undefined, limit: 200000 });

  const lines: string[] = [
    '-- IELTS Dictionary Export',
    `-- Generated: ${new Date().toISOString()}`,
    `-- Total words: ${words.length}`,
    '',
    'BEGIN TRANSACTION;',
    '',
    'CREATE TABLE IF NOT EXISTS vocabulary (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  word TEXT NOT NULL UNIQUE,',
    '  definition TEXT,',
    '  definition_vi TEXT,',
    '  example TEXT,',
    '  example_vi TEXT,',
    '  topic TEXT,',
    '  pronunciation TEXT,',
    '  part_of_speech TEXT,',
    '  level TEXT',
    ');',
    '',
    'CREATE VIRTUAL TABLE IF NOT EXISTS vocab_fts USING fts5(',
    '  word,',
    "  content='vocabulary',",
    "  content_rowid='id'",
    ');',
    '',
  ];

  // Batch INSERT statements (500 per batch for performance)
  const BATCH = 500;
  for (let i = 0; i < words.length; i += BATCH) {
    const batch = words.slice(i, i + BATCH);
    const values = batch.map(w => {
      const esc = (s: string | null | undefined) =>
        s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`;
      return `(${esc(w.word)},${esc(w.definition)},${esc(w.definition_vi)},${esc(w.example)},${esc(w.example_vi)},${esc(w.topic)},${esc(w.pronunciation)},${esc(w.part_of_speech)},${esc(w.level)})`;
    }).join(',\n  ');
    lines.push(`INSERT OR IGNORE INTO vocabulary (word,definition,definition_vi,example,example_vi,topic,pronunciation,part_of_speech,level) VALUES`);
    lines.push(`  ${values};`);
    lines.push('');
  }

  lines.push('-- Rebuild FTS index');
  lines.push("INSERT INTO vocab_fts(vocab_fts) VALUES('rebuild');");
  lines.push('');
  lines.push('COMMIT;');

  const sql = lines.join('\n');
  return new Response(sql, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="dictionary_${new Date().toISOString().slice(0,10)}.sql"`,
    },
  });
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
