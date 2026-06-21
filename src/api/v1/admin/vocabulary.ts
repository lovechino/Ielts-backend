import { Hono } from 'hono';
import { VocabularyService } from '../../../services/vocabulary.service';
import type { Bindings, Variables } from '../../../index';
import { adminGuard } from '../../../middleware/auth';
import { writeAdminAuditLog } from '../../../services/admin-audit.service';

const adminVocabRouter = new Hono<{ Bindings: Bindings, Variables: Variables }>({ strict: false });

adminVocabRouter.use('/*', adminGuard);

adminVocabRouter.post('/paths', async (c) => {
  const body = await c.req.json();
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const course = await service.createCourse(body);
  await writeAdminAuditLog(c, 'vocab_course.create', {
    targetType: 'vocab_course',
    targetId: course?.id,
    metadata: { title: body.title, slug: body.slug },
  });
  return c.json({ success: true, data: course });
});

adminVocabRouter.put('/paths/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const course = await service.updateCourse(id, body);
  await writeAdminAuditLog(c, 'vocab_course.update', {
    targetType: 'vocab_course',
    targetId: id,
    metadata: { fields: Object.keys(body) },
  });
  return c.json({ success: true, data: course });
});

adminVocabRouter.delete('/paths/:id', async (c) => {
  const id = c.req.param('id');
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const result = await service.deleteCourse(id);
  await writeAdminAuditLog(c, 'vocab_course.delete', {
    targetType: 'vocab_course',
    targetId: id,
  });
  return c.json(result);
});

adminVocabRouter.post('/bulk-import', async (c) => {
  const { vocab_course_id, words } = await c.req.json();
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const result = await service.bulkImportVocabulary(vocab_course_id, words);
  await writeAdminAuditLog(c, 'vocabulary.bulk_import', {
    targetType: 'vocab_course',
    targetId: vocab_course_id,
    metadata: { wordCount: Array.isArray(words) ? words.length : 0 },
  });
  return c.json({ success: true, data: result });
});

// GET /vocabulary/export-sql — xuất toàn bộ vocabulary thành SQL INSERT statements
// để admin đóng gói vào dictionary.db
adminVocabRouter.get('/export-sql', async (c) => {
  const vocab_course_id = c.req.query('vocab_course_id');
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const words = await service.getAll({ vocab_course_id: vocab_course_id || undefined, limit: 200000 });
  const courses = await service.getCourses();

  const lines: string[] = [
    '-- IELTS Dictionary Export',
    `-- Generated: ${new Date().toISOString()}`,
    `-- Total words: ${words.length}`,
    `-- Total courses: ${courses.length}`,
    '',
    'BEGIN TRANSACTION;',
    '',
    'CREATE TABLE IF NOT EXISTS vocab_courses (',
    '  id TEXT PRIMARY KEY,',
    '  title TEXT NOT NULL,',
    '  slug TEXT NOT NULL UNIQUE,',
    '  description TEXT,',
    '  thumbnail_url TEXT,',
    '  created_at INTEGER',
    ');',
    '',
    'CREATE TABLE IF NOT EXISTS vocabulary (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  vocab_course_id TEXT,',
    '  word TEXT NOT NULL UNIQUE,',
    '  definition TEXT,',
    '  definition_vi TEXT,',
    '  example TEXT,',
    '  example_vi TEXT,',
    '  topic TEXT,',
    '  pronunciation TEXT,',
    '  part_of_speech TEXT,',
    '  level TEXT,',
    '  is_priority INTEGER DEFAULT 0,',
    '  is_academic INTEGER DEFAULT 0,',
    '  updated_at INTEGER',
    ');',
    '',
    'CREATE VIRTUAL TABLE IF NOT EXISTS vocab_fts USING fts5(',
    '  word,',
    "  content='vocabulary',",
    "  content_rowid='id'",
    ');',
    '',
  ];

  // Insert courses
  if (courses.length > 0) {
    const courseValues = courses.map((c: any) => {
      const esc = (s: string | null | undefined) => {
        if (s == null) return 'NULL';
        return `'${String(s).replace(/'/g, "''")}'`;
      };
      // created_at is timestamp, fallback to 0 if null
      const created_at = c.created_at ? new Date(c.created_at).getTime() / 1000 : 0;
      return `(${esc(c.id)},${esc(c.title)},${esc(c.slug)},${esc(c.description)},${esc(c.thumbnail_url)},${created_at})`;
    }).join(',\n  ');
    
    lines.push(`INSERT OR IGNORE INTO vocab_courses (id,title,slug,description,thumbnail_url,created_at) VALUES`);
    lines.push(`  ${courseValues};`);
    lines.push('');
  }

  // Batch INSERT statements (500 per batch for performance)
  const BATCH = 500;
  for (let i = 0; i < words.length; i += BATCH) {
    const batch = words.slice(i, i + BATCH);
    const values = batch.map((w: any) => {
      const esc = (s: string | number | boolean | null | undefined) => {
        if (s == null) return 'NULL';
        if (typeof s === 'boolean') return s ? 1 : 0;
        return `'${String(s).replace(/'/g, "''")}'`;
      };
      return `(${esc(w.word)},${esc(w.vocab_course_id)},${esc(w.definition)},${esc(w.definition_vi)},${esc(w.example)},${esc(w.example_vi)},${esc(w.topic)},${esc(w.pronunciation)},${esc(w.part_of_speech)},${esc(w.level)},${w.is_priority ? 1 : 0},${w.is_academic ? 1 : 0},${w.updated_at || 0})`;
    }).join(',\n  ');
    lines.push(`INSERT OR IGNORE INTO vocabulary (word,vocab_course_id,definition,definition_vi,example,example_vi,topic,pronunciation,part_of_speech,level,is_priority,is_academic,updated_at) VALUES`);
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
  await writeAdminAuditLog(c, 'vocabulary.upsert', {
    targetType: 'vocabulary',
    targetId: word?.id ?? body.id ?? body.word,
    metadata: { word: body.word },
  });
  return c.json({ success: true, data: word });
});

adminVocabRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const result = await service.deleteVocabulary(id);
  await writeAdminAuditLog(c, 'vocabulary.delete', {
    targetType: 'vocabulary',
    targetId: id,
  });
  return c.json(result);
});

export default adminVocabRouter;
