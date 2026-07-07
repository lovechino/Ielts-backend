import { Hono } from 'hono';
import { VocabularyService } from '../../../services/vocabulary.service';
import type { Bindings, Variables } from '../../../index';
import { adminGuard } from '../../../middleware/auth';
import { writeAdminAuditLog } from '../../../services/admin-audit.service';

const adminVocabRouter = new Hono<{ Bindings: Bindings, Variables: Variables }>({ strict: false });
const KV_PUB_KEY = 'vocab_db_version';

async function bumpDictionaryVersion(c: any) {
  await c.env.CACHE.put(KV_PUB_KEY, String(Math.floor(Date.now() / 1000)));
}

adminVocabRouter.use('/*', adminGuard);

adminVocabRouter.post('/paths/:id/lessons', async (c) => {
  const courseId = c.req.param('id');
  const body = await c.req.json();
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const lesson = await service.createLesson(courseId, body);
  await bumpDictionaryVersion(c);
  await writeAdminAuditLog(c, 'vocab_course.lesson_create', {
    targetType: 'vocab_course_lesson', targetId: lesson.id,
    metadata: { courseId, title: body.title },
  });
  return c.json({ success: true, data: lesson });
});

adminVocabRouter.get('/paths/:id/lessons', async (c) => {
  const courseId = c.req.param('id');
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const lessons = await service.getLessons(courseId);
  return c.json({ success: true, data: lessons });
});

adminVocabRouter.put('/paths/:id/lessons/:lessonId', async (c) => {
  const lessonId = c.req.param('lessonId');
  const body = await c.req.json();
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const result = await service.updateLesson(lessonId, body);
  await bumpDictionaryVersion(c);
  await writeAdminAuditLog(c, 'vocab_course.lesson_update', {
    targetType: 'vocab_course_lesson', targetId: lessonId,
    metadata: { fields: Object.keys(body) },
  });
  return c.json({ success: true, data: result });
});

adminVocabRouter.delete('/paths/:id/lessons/:lessonId', async (c) => {
  const lessonId = c.req.param('lessonId');
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const result = await service.deleteLesson(lessonId);
  await bumpDictionaryVersion(c);
  await writeAdminAuditLog(c, 'vocab_course.lesson_delete', {
    targetType: 'vocab_course_lesson', targetId: lessonId,
  });
  return c.json({ success: true, data: result });
});

adminVocabRouter.post('/paths/:id/lessons/:lessonId/words/import', async (c) => {
  try {
    const courseId = c.req.param('id');
    const lessonId = c.req.param('lessonId');
    const { words } = await c.req.json();
    const service = new VocabularyService(c.env.DB, c.env.CACHE);
    const result = await service.importWordsToLesson(courseId, lessonId, words);
    await bumpDictionaryVersion(c);
    await writeAdminAuditLog(c, 'vocab_course.lesson_words_import', {
      targetType: 'vocab_course_lesson', targetId: lessonId,
      metadata: { wordCount: Array.isArray(words) ? words.length : 0, mapped: result.mapped },
    });
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: { code: 'LESSON_WORD_IMPORT_FAILED', message: error?.message } }, 400);
  }
});

adminVocabRouter.post('/paths', async (c) => {
  const body = await c.req.json();
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const course = await service.createCourse(body);
  await bumpDictionaryVersion(c);
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
  await bumpDictionaryVersion(c);
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
  await bumpDictionaryVersion(c);
  await writeAdminAuditLog(c, 'vocab_course.delete', {
    targetType: 'vocab_course',
    targetId: id,
  });
  return c.json(result);
});

adminVocabRouter.post('/bulk-import', async (c) => {
  try {
    const { vocab_course_id, words } = await c.req.json();
    const service = new VocabularyService(c.env.DB, c.env.CACHE);
    const result = await service.bulkImportVocabulary(vocab_course_id, words);
    await bumpDictionaryVersion(c);
    await writeAdminAuditLog(c, 'vocabulary.bulk_import', {
      targetType: 'vocab_course',
      targetId: vocab_course_id,
      metadata: { wordCount: Array.isArray(words) ? words.length : 0, failed: result.failed },
    });
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({
      success: false,
      error: { code: 'BULK_IMPORT_FAILED', message: error?.message || 'Bulk import failed' },
    }, 400);
  }
});

adminVocabRouter.post('/paths/:id/words/import', async (c) => {
  try {
    const courseId = c.req.param('id');
    const { words } = await c.req.json();
    const service = new VocabularyService(c.env.DB, c.env.CACHE);
    const result = await service.importWordsToCourse(courseId, words);
    await bumpDictionaryVersion(c);
    await writeAdminAuditLog(c, 'vocab_course.words_import', {
      targetType: 'vocab_course',
      targetId: courseId,
      metadata: { wordCount: Array.isArray(words) ? words.length : 0, mapped: result.mapped, missing: result.missing_count },
    });
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({
      success: false,
      error: { code: 'COURSE_WORD_IMPORT_FAILED', message: error?.message || 'Course word import failed' },
    }, 400);
  }
});

adminVocabRouter.delete('/paths/:id/words/:vocabId', async (c) => {
  const courseId = c.req.param('id');
  const vocabId = Number(c.req.param('vocabId'));
  if (!Number.isFinite(vocabId)) {
    return c.json({ success: false, error: { code: 'INVALID_VOCAB_ID', message: 'Invalid vocabulary id' } }, 400);
  }

  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const result = await service.removeWordFromCourse(courseId, vocabId);
  await bumpDictionaryVersion(c);
  await writeAdminAuditLog(c, 'vocab_course.word_remove', {
    targetType: 'vocab_course',
    targetId: courseId,
    metadata: { vocabId },
  });
  return c.json(result);
});

// GET /vocabulary/export-sql — xuất toàn bộ vocabulary thành SQL INSERT statements
// để admin đóng gói vào dictionary.db
adminVocabRouter.get('/export-sql', async (c) => {
  const vocab_course_id = c.req.query('vocab_course_id');
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const words = await service.getAll({ vocab_course_id: vocab_course_id || undefined, limit: 1000000 });
  const courses = await service.getCourses();
  const courseWordMappings = vocab_course_id ? [] : await service.getAllCourseWordMappings();

  // Fetch all lessons for export
  let allLessons: any[] = [];
  if (!vocab_course_id) {
    for (const course of courses as any[]) {
      const lessons = await service.getLessons(course.id);
      allLessons = allLessons.concat(lessons.map((l: any) => ({ ...l, course_id: course.id })));
    }
  }

  const lines: string[] = [
    '-- IELTS Dictionary Export',
    `-- Generated: ${new Date().toISOString()}`,
    `-- Total words: ${words.length}`,
    `-- Total courses: ${courses.length}`,
    `-- Total lessons: ${allLessons.length}`,
    '',
    'BEGIN TRANSACTION;',
    '',
    'CREATE TABLE IF NOT EXISTS vocab_courses (',
    '  id TEXT PRIMARY KEY,',
    '  title TEXT NOT NULL,',
    '  slug TEXT NOT NULL UNIQUE,',
    '  description TEXT,',
    '  thumbnail_url TEXT,',
    '  level TEXT,',
    "  status TEXT DEFAULT 'published',",
    '  created_at INTEGER,',
    '  updated_at INTEGER,',
    '  is_deleted INTEGER DEFAULT 0',
    ');',
    '',
    'CREATE TABLE IF NOT EXISTS vocab_course_lessons (',
    '  id TEXT PRIMARY KEY,',
    '  course_id TEXT NOT NULL,',
    '  title TEXT NOT NULL,',
    '  description TEXT,',
    '  order_index INTEGER DEFAULT 0,',
    "  created_at INTEGER DEFAULT (strftime('%s','now')),",
    "  updated_at INTEGER DEFAULT (strftime('%s','now')),",
    '  is_deleted INTEGER DEFAULT 0',
    ');',
    '',
    'CREATE TABLE IF NOT EXISTS vocab_course_words (',
    '  id TEXT PRIMARY KEY,',
    '  course_id TEXT NOT NULL,',
    '  lesson_id TEXT,',
    '  vocab_id INTEGER NOT NULL,',
    '  order_index INTEGER DEFAULT 0,',
    '  section TEXT,',
    '  is_featured INTEGER DEFAULT 0,',
    "  created_at INTEGER DEFAULT (strftime('%s', 'now')),",
    '  updated_at INTEGER,',
    '  is_deleted INTEGER DEFAULT 0,',
    '  UNIQUE(course_id, vocab_id)',
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
    'CREATE INDEX IF NOT EXISTS idx_vocabulary_topic ON vocabulary(topic);',
    'CREATE INDEX IF NOT EXISTS idx_vocabulary_level ON vocabulary(level);',
    'CREATE INDEX IF NOT EXISTS idx_vocabulary_sync ON vocabulary(status, updated_at);',
    'CREATE INDEX IF NOT EXISTS idx_vocab_course_words_course ON vocab_course_words(course_id, order_index);',
    'CREATE INDEX IF NOT EXISTS idx_vocab_course_words_vocab ON vocab_course_words(vocab_id);',
    'CREATE INDEX IF NOT EXISTS idx_vocab_courses_sync ON vocab_courses(updated_at, is_deleted);',
    'CREATE INDEX IF NOT EXISTS idx_vocab_course_words_sync ON vocab_course_words(updated_at, is_deleted);',
    '',
  ];

  // Insert courses
  if (courses.length > 0) {
    const courseValues = courses.map((c: any) => {
      const esc = (s: string | null | undefined) => {
        if (s == null) return 'NULL';
        return `'${String(s).replace(/'/g, "''")}'`;
      };
      const created_at = c.created_at ? new Date(c.created_at).getTime() / 1000 : 0;
      return `(${esc(c.id)},${esc(c.title)},${esc(c.slug)},${esc(c.description)},${esc(c.thumbnail_url)},${esc(c.level)},${esc(c.status || 'published')},${created_at},${Number(c.updated_at || 0)},${c.is_deleted ? 1 : 0})`;
    }).join(',\n  ');
    lines.push(`INSERT OR IGNORE INTO vocab_courses (id,title,slug,description,thumbnail_url,level,status,created_at,updated_at,is_deleted) VALUES`);
    lines.push(`  ${courseValues};`);
    lines.push('');
  }

  // Insert lessons
  if (allLessons.length > 0) {
    const BATCH_L = 500;
    for (let i = 0; i < allLessons.length; i += BATCH_L) {
      const batch = allLessons.slice(i, i + BATCH_L);
      const values = batch.map((l: any) => {
        const esc = (s: string | number | null | undefined) => {
          if (s == null) return 'NULL';
          return `'${String(s).replace(/'/g, "''")}'`;
        };
        return `(${esc(l.id)},${esc(l.course_id)},${esc(l.title)},${esc(l.description)},${Number(l.order_index || 0)},${Number(l.updated_at || 0)},0)`;
      }).join(',\n  ');
      lines.push('INSERT OR IGNORE INTO vocab_course_lessons (id,course_id,title,description,order_index,updated_at,is_deleted) VALUES');
      lines.push(`  ${values};`);
      lines.push('');
    }
  }

  if (courseWordMappings.length > 0) {
    const BATCH = 1000;
    for (let i = 0; i < courseWordMappings.length; i += BATCH) {
      const batch = courseWordMappings.slice(i, i + BATCH);
      const values = batch.map((m: any) => {
        const esc = (s: string | number | boolean | null | undefined) => {
          if (s == null) return 'NULL';
          if (typeof s === 'boolean') return s ? 1 : 0;
          return `'${String(s).replace(/'/g, "''")}'`;
        };
        return `(${esc(crypto.randomUUID())},${esc(m.course_id)},${esc(null)},${Number(m.vocab_id)},${Number(m.order_index || 0)},${esc(m.section)},${m.is_featured ? 1 : 0},${Number(m.updated_at || 0)},${m.is_deleted ? 1 : 0})`;
      }).join(',\n  ');
      lines.push('INSERT OR IGNORE INTO vocab_course_words (id,course_id,lesson_id,vocab_id,order_index,section,is_featured,updated_at,is_deleted) VALUES');
      lines.push(`  ${values};`);
      lines.push('');
    }
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
  await bumpDictionaryVersion(c);
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
  await bumpDictionaryVersion(c);
  await writeAdminAuditLog(c, 'vocabulary.delete', {
    targetType: 'vocabulary',
    targetId: id,
  });
  return c.json(result);
});

export default adminVocabRouter;
