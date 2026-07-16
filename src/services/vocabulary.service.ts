import { drizzle } from 'drizzle-orm/d1';
import { dictionaryReleases, vocabulary, vocabCourses, vocabCourseWords, vocabCourseLessons } from '../db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import type { D1Database } from '@cloudflare/workers-types';
import type { KVNamespace } from '@cloudflare/workers-types';

const CACHE_TTL = 3600; // 1 hour — vocabulary is very static

export class VocabularyService {
  private db;
  private d1: D1Database;
  private cache: KVNamespace | null;

  constructor(d1: D1Database, cache?: KVNamespace) {
    this.d1 = d1;
    this.db = drizzle(d1);
    this.cache = cache || null;
  }

  async getAll(params: { 
    level?: string; 
    topic?: string; 
    vocab_course_id?: string; 
    structure_type?: string; 
    is_priority?: boolean;
    is_academic?: boolean;
    limit?: number; 
    offset?: number;
    section?: string;
  } = {}) {
    const cacheKey = `vocab:${params.vocab_course_id || 'all'}:${params.level || 'all'}:${params.topic || 'all'}:${params.structure_type || 'all'}:${params.is_priority ?? 'all'}:${params.is_academic ?? 'all'}:${params.limit || 'all'}:${params.offset || 0}`;
    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }
    if (params.vocab_course_id) {
      const result = await this.getCourseWords(params.vocab_course_id, {
        limit: params.limit,
        offset: params.offset,
        mode: 'full',
        section: params.section,
      });
      if (this.cache) await this.cache.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL });
      return result;
    }

    const conditions = [];
    if (params.level) conditions.push(eq(vocabulary.level, params.level));
    if (params.topic) conditions.push(eq(vocabulary.topic, params.topic));
    
    if (params.is_priority !== undefined) {
      conditions.push(eq(vocabulary.is_priority, params.is_priority));
    }
    if (params.is_academic !== undefined) {
      conditions.push(eq(vocabulary.is_academic, params.is_academic));
    }

    if (params.structure_type === 'cefr_levels' && !params.level) {
      conditions.push(sql`${vocabulary.level} IN ('A1','A2','B1','B2','C1','C2')`);
    }
    let query = this.db.select().from(vocabulary).$dynamic();
    if (conditions.length > 0) query = query.where(and(...conditions));
    
    // Always order by priority for better UX in large lists
    query = query.orderBy(sql`${vocabulary.is_priority} DESC, ${vocabulary.word} ASC`);

    if (params.limit) query = query.limit(params.limit);
    if (params.offset) query = query.offset(params.offset);
    const result = await query.all();
    if (this.cache) await this.cache.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL });
    return result;
  }

  async getByWord(word: string) {
    const cacheKey = `vocab:word:${word}`;
    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }
    const result = await this.db.select()
      .from(vocabulary)
      .where(eq(vocabulary.word, word))
      .get();
    if (this.cache && result) {
      await this.cache.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL });
    }
    return result;
  }

  async getCourses() {
    return this.d1.prepare(`
      SELECT
        c.*,
        COALESCE(mapped.word_count, legacy.word_count, 0) as word_count
      FROM vocab_courses c
      LEFT JOIN (
        SELECT course_id, COUNT(*) as word_count
        FROM vocab_course_words
        WHERE is_deleted = 0
        GROUP BY course_id
      ) mapped ON mapped.course_id = c.id
      LEFT JOIN (
        SELECT vocab_course_id, COUNT(*) as word_count
        FROM vocabulary
        WHERE vocab_course_id IS NOT NULL AND is_deleted = 0
        GROUP BY vocab_course_id
      ) legacy ON legacy.vocab_course_id = c.id
      WHERE COALESCE(c.is_deleted, 0) = 0
      ORDER BY c.created_at DESC
    `).all().then((res) => res.results || []);
  }

  async getCourseWords(courseId: string, options: { limit?: number; offset?: number; mode?: 'full' | 'ids'; section?: string } = {}) {
    const limit = Math.min(Math.max(Number(options.limit || 2000), 1), 5000);
    const offset = Math.max(Number(options.offset || 0), 0);
    const sectionFilter = options.section ? options.section : null;

    const mappedCount = await this.d1.prepare(
      'SELECT COUNT(*) as count FROM vocab_course_words WHERE course_id = ? AND COALESCE(is_deleted, 0) = 0'
    ).bind(courseId).first<{ count: number }>();

    if ((mappedCount?.count || 0) > 0) {
      const sectionQuery = sectionFilter 
        ? "AND COALESCE(cw.section, 'Chung') = ?" 
        : "";
      const binds = sectionFilter 
        ? [courseId, sectionFilter, limit, offset] 
        : [courseId, limit, offset];

      if (options.mode === 'ids') {
        const result = await this.d1.prepare(`
          SELECT cw.vocab_id, v.word, cw.order_index, cw.section, cw.is_featured
          FROM vocab_course_words cw
          JOIN vocabulary v ON v.id = cw.vocab_id
          WHERE cw.course_id = ?
            AND COALESCE(cw.is_deleted, 0) = 0
            AND v.status = 'published'
            AND v.is_deleted = 0
            ${sectionQuery}
          ORDER BY cw.order_index ASC, v.word ASC
          LIMIT ? OFFSET ?
        `).bind(...binds).all();
        return result.results || [];
      }

      const result = await this.d1.prepare(`
        SELECT v.*, cw.order_index, cw.lesson_id, cw.section, cw.is_featured
        FROM vocab_course_words cw
        JOIN vocabulary v ON v.id = cw.vocab_id
        WHERE cw.course_id = ?
          AND COALESCE(cw.is_deleted, 0) = 0
          AND v.status = 'published'
          AND v.is_deleted = 0
          ${sectionQuery}
        ORDER BY cw.order_index ASC, v.word ASC
        LIMIT ? OFFSET ?
      `).bind(...binds).all();
      return result.results || [];
    }

    // For legacy/unmapped courses (words linked directly via vocabulary.vocab_course_id)
    // Legacy words don't have a section column in vocabulary, so they all default to 'Chung'.
    if (sectionFilter && sectionFilter !== 'Chung') {
      return [];
    }

    if (options.mode === 'ids') {
      const result = await this.d1.prepare(`
        SELECT id as vocab_id, word, 0 as order_index, NULL as section, 0 as is_featured
        FROM vocabulary
        WHERE vocab_course_id = ?
          AND status = 'published'
          AND is_deleted = 0
        ORDER BY is_priority DESC, word ASC
        LIMIT ? OFFSET ?
      `).bind(courseId, limit, offset).all();
      return result.results || [];
    }

    const result = await this.d1.prepare(`
      SELECT *
      FROM vocabulary
      WHERE vocab_course_id = ?
        AND status = 'published'
        AND is_deleted = 0
      ORDER BY is_priority DESC, word ASC
      LIMIT ? OFFSET ?
    `).bind(courseId, limit, offset).all();
    return result.results || [];
  }

  async getCourseSections(courseId: string) {
    // Primary: read from vocab_course_lessons (new structured lessons)
    try {
      const lessonsCount = await this.d1.prepare(
        'SELECT COUNT(*) as count FROM vocab_course_lessons WHERE course_id = ? AND is_deleted = 0'
      ).bind(courseId).first<{ count: number }>();

      if ((lessonsCount?.count || 0) > 0) {
        const result = await this.d1.prepare(`
          SELECT l.title as name, l.order_index,
            COUNT(CASE WHEN cw.is_deleted = 0 THEN 1 END) as word_count
          FROM vocab_course_lessons l
          LEFT JOIN vocab_course_words cw ON cw.lesson_id = l.id
          WHERE l.course_id = ? AND l.is_deleted = 0
          GROUP BY l.id
          ORDER BY l.order_index ASC, l.created_at ASC
        `).bind(courseId).all();
        return result.results || [];
      }
    } catch {
      // Table may not exist yet; fall through to legacy section grouping
    }

    // Fallback: legacy section text grouping
    const mappedCount = await this.d1.prepare(
      'SELECT COUNT(*) as count FROM vocab_course_words WHERE course_id = ? AND COALESCE(is_deleted, 0) = 0'
    ).bind(courseId).first<{ count: number }>();

    if ((mappedCount?.count || 0) > 0) {
      const result = await this.d1.prepare(`
        SELECT 
          COALESCE(section, 'Chung') as name,
          COUNT(*) as word_count
        FROM vocab_course_words cw
        JOIN vocabulary v ON v.id = cw.vocab_id
        WHERE cw.course_id = ? 
          AND COALESCE(cw.is_deleted, 0) = 0 
          AND v.status = 'published' 
          AND v.is_deleted = 0
        GROUP BY COALESCE(section, 'Chung')
        ORDER BY MIN(cw.order_index) ASC, COALESCE(section, 'Chung') ASC
      `).bind(courseId).all();
      return result.results || [];
    }

    // Legacy: words linked via vocabulary.vocab_course_id
    const countRes = await this.d1.prepare(
      "SELECT COUNT(*) as count FROM vocabulary WHERE vocab_course_id = ? AND status = 'published' AND is_deleted = 0"
    ).bind(courseId).first<{ count: number }>();
    if ((countRes?.count || 0) > 0) {
      return [{ name: 'Chung', word_count: countRes!.count }];
    }
    return [];
  }

  async getAllCourseWordMappings(limit = 1000000) {
    // Join with lessons to populate section = lesson title for backward compat
    const result = await this.d1.prepare(`
      SELECT cw.course_id, cw.vocab_id, cw.order_index,
        COALESCE(l.title, cw.section) as section,
        cw.is_featured, cw.updated_at, cw.is_deleted
      FROM vocab_course_words cw
      LEFT JOIN vocab_course_lessons l ON l.id = cw.lesson_id AND l.is_deleted = 0
      WHERE COALESCE(cw.is_deleted, 0) = 0
      ORDER BY cw.course_id ASC, cw.order_index ASC, cw.vocab_id ASC
      LIMIT ?
    `).bind(limit).all();
    return result.results || [];
  }

  async createCourse(data: { id?: string; title: string; slug: string; description?: string; thumbnail_url?: string; level?: string }) {
    const { id: _ignoredId, ...courseData } = data;
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await this.db.insert(vocabCourses).values({ ...courseData, id, status: 'published', updated_at: now, is_deleted: 0 }).run();
    return { id, ...courseData };
  }

  async updateCourse(id: string, data: any) {
    const { id: _ignoredId, ...courseData } = data;
    await this.db.update(vocabCourses).set({ ...courseData, updated_at: Math.floor(Date.now() / 1000) }).where(eq(vocabCourses.id, id)).run();
    return this.db.select().from(vocabCourses).where(eq(vocabCourses.id, id)).get();
  }

  async deleteCourse(id: string) {
    if (!id) return { success: false };

    const now = Math.floor(Date.now() / 1000);

    await this.d1.batch([
      this.d1.prepare('UPDATE vocab_course_words SET is_deleted = 1, updated_at = ? WHERE course_id = ?').bind(now, id),
      this.d1.prepare('UPDATE vocab_course_lessons SET is_deleted = 1, updated_at = ? WHERE course_id = ?').bind(now, id),
      this.d1.prepare('UPDATE vocabulary SET vocab_course_id = NULL, updated_at = ? WHERE vocab_course_id = ?').bind(now, id),
      this.d1.prepare('UPDATE vocab_courses SET is_deleted = 1, updated_at = ? WHERE id = ?').bind(now, id),
    ]);

    if (this.cache) {
      const cacheKeys = [
        `vocab:${id}:all:all:all:all:all:all:0`,
        `vocab:${id}:all:all:all:all:all:2000:0`,
        `vocab:${id}:all:all:all:all:all:200000:0`,
        `vocab:${id}:all:all:all:all:all:5000:0`,
      ];
      await Promise.all(cacheKeys.map((key) => this.cache!.delete(key)));
    }

    return { success: true };
  }

  // ── Vocab Course Lessons ────────────────────────────────────────────────────

  async getLessons(courseId: string) {
    const result = await this.d1.prepare(`
      SELECT l.*,
        COUNT(CASE WHEN cw.is_deleted = 0 THEN 1 END) as word_count
      FROM vocab_course_lessons l
      LEFT JOIN vocab_course_words cw ON cw.lesson_id = l.id
      WHERE l.course_id = ? AND l.is_deleted = 0
      GROUP BY l.id
      ORDER BY l.order_index ASC, l.created_at ASC
    `).bind(courseId).all();
    return result.results || [];
  }

  async createLesson(courseId: string, data: { title: string; description?: string; order_index?: number }) {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    // Auto-assign order_index if not provided
    let orderIndex = data.order_index;
    if (orderIndex === undefined || orderIndex === null) {
      const row = await this.d1.prepare(
        'SELECT COALESCE(MAX(order_index), -1) as max_order FROM vocab_course_lessons WHERE course_id = ? AND is_deleted = 0'
      ).bind(courseId).first<{ max_order: number }>();
      orderIndex = (row?.max_order ?? -1) + 1;
    }

    await this.d1.prepare(`
      INSERT INTO vocab_course_lessons (id, course_id, title, description, order_index, created_at, updated_at, is_deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).bind(id, courseId, data.title, data.description ?? null, orderIndex, now, now).run();

    // Bump course updated_at so mobile sync picks it up
    await this.d1.prepare('UPDATE vocab_courses SET updated_at = ? WHERE id = ?').bind(now, courseId).run();

    return { id, course_id: courseId, title: data.title, description: data.description ?? null, order_index: orderIndex, word_count: 0 };
  }

  async updateLesson(lessonId: string, data: { title?: string; description?: string; order_index?: number }) {
    const now = Math.floor(Date.now() / 1000);
    const sets: string[] = ['updated_at = ?'];
    const binds: any[] = [now];
    if (data.title !== undefined) { sets.push('title = ?'); binds.push(data.title); }
    if (data.description !== undefined) { sets.push('description = ?'); binds.push(data.description); }
    if (data.order_index !== undefined) { sets.push('order_index = ?'); binds.push(data.order_index); }
    binds.push(lessonId);
    await this.d1.prepare(`UPDATE vocab_course_lessons SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return { success: true };
  }

  async deleteLesson(lessonId: string) {
    const now = Math.floor(Date.now() / 1000);
    // Soft-delete words in this lesson
    await this.d1.prepare(
      'UPDATE vocab_course_words SET is_deleted = 1, updated_at = ? WHERE lesson_id = ?'
    ).bind(now, lessonId).run();
    // Soft-delete lesson
    await this.d1.prepare(
      'UPDATE vocab_course_lessons SET is_deleted = 1, updated_at = ? WHERE id = ?'
    ).bind(now, lessonId).run();
    return { success: true };
  }

  async importWordsToLesson(courseId: string, lessonId: string, items: any[]) {
    if (!lessonId) throw new Error('lessonId is required');
    // Delegate to importWordsToCourse with lessonId
    const result = await this.importWordsToCourse(courseId, items, lessonId);
    return result;
  }

  async importWordsToCourse(courseId: string, items: any[], lessonId?: string) {
    if (!courseId) throw new Error('courseId is required');
    if (!Array.isArray(items)) throw new Error('words must be an array');

    // Resolve section name from lesson title (backward compat for mobile)
    let lessonTitle: string | null = null;
    if (lessonId) {
      const lesson = await this.d1.prepare(
        'SELECT title FROM vocab_course_lessons WHERE id = ? AND is_deleted = 0'
      ).bind(lessonId).first<{ title: string }>();
      lessonTitle = lesson?.title ?? null;
    }

    const normalized = items.map((item, index) => ({
      index,
      word: String(typeof item === 'string' ? item : item?.word || '').trim().toLowerCase(),
      section: lessonTitle ?? (typeof item === 'object' ? item?.section || null : null),
      is_featured: typeof item === 'object' && item?.is_featured ? 1 : 0,
    })).filter((item) => item.word);

    if (normalized.length === 0) return { count: 0, mapped: 0, failed: 0, missing: [], missing_count: 0, skipped: 0, errors: [] };

    const uniqueWords = Array.from(new Set(normalized.map((item) => item.word)));
    const found = new Map<string, { id: number; word: string }>();
    const CHUNK = 900;
    for (let i = 0; i < uniqueWords.length; i += CHUNK) {
      const chunk = uniqueWords.slice(i, i + CHUNK);
      const rows = await this.db.select({ id: vocabulary.id, word: vocabulary.word })
        .from(vocabulary)
        .where(and(
          inArray(vocabulary.word, chunk),
          eq(vocabulary.is_deleted, 0),
        ))
        .all();
      rows.forEach((row) => found.set(String(row.word).toLowerCase(), row));
    }

    let mapped = 0;
    let skipped = 0;
    const missing: string[] = [];
    const statements = [];
    for (const item of normalized) {
      const vocab = found.get(item.word);
      if (!vocab) {
        missing.push(item.word);
        continue;
      }
      statements.push(this.d1.prepare(`
        INSERT INTO vocab_course_words (id, course_id, lesson_id, vocab_id, order_index, section, is_featured, updated_at, is_deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(course_id, vocab_id) DO UPDATE SET
          lesson_id = excluded.lesson_id,
          order_index = excluded.order_index,
          section = excluded.section,
          is_featured = excluded.is_featured,
          updated_at = excluded.updated_at,
          is_deleted = 0
      `).bind(crypto.randomUUID(), courseId, lessonId ?? null, vocab.id, item.index, item.section, item.is_featured, Math.floor(Date.now() / 1000)));
    }

    if (statements.length > 0) {
      try {
        const results = await this.d1.batch(statements);
        mapped = results.filter((res: any) => res.success !== false).length;
        skipped = statements.length - mapped;
      } catch {
        for (const statement of statements) {
          try {
            await statement.run();
            mapped += 1;
          } catch {
            skipped += 1;
          }
        }
      }
    }

    if (this.cache) {
      await this.cache.delete(`vocab:${courseId}:all:all:all:all:all:all:0`);
      await this.cache.delete(`vocab:${courseId}:all:all:all:all:all:2000:0`);
    }

    return {
      count: normalized.length,
      mapped,
      failed: missing.length + skipped,
      skipped,
      missing: Array.from(new Set(missing)).slice(0, 100),
      missing_count: missing.length,
      errors: [],
    };
  }

  async removeWordFromCourse(courseId: string, vocabId: number) {
    const now = Math.floor(Date.now() / 1000);
    await this.d1.prepare(
      'UPDATE vocab_course_words SET is_deleted = 1, updated_at = ? WHERE course_id = ? AND vocab_id = ?'
    ).bind(now, courseId, vocabId).run();

    const mappedCount = await this.d1.prepare(
      'SELECT COUNT(*) as count FROM vocab_course_words WHERE course_id = ? AND COALESCE(is_deleted, 0) = 0'
    ).bind(courseId).first<{ count: number }>();

    if ((mappedCount?.count || 0) === 0) {
      await this.d1.prepare(
        'UPDATE vocabulary SET vocab_course_id = NULL WHERE vocab_course_id = ? AND id = ?'
      ).bind(courseId, vocabId).run();
    }

    if (this.cache) {
      await this.cache.delete(`vocab:${courseId}:all:all:all:all:all:all:0`);
      await this.cache.delete(`vocab:${courseId}:all:all:all:all:all:2000:0`);
    }

    return { success: true };
  }

  async upsertVocabulary(data: any) {
    const existing = await this.db.select().from(vocabulary).where(eq(vocabulary.word, data.word)).get();
    const now = Math.floor(Date.now() / 1000);
    if (existing) {
      const updateData = { ...data, updated_at: now };
      await this.db.update(vocabulary).set(updateData).where(eq(vocabulary.id, existing.id)).run();
      return { ...existing, ...updateData };
    }
    const newWord = { ...data, status: data.status || 'published', updated_at: now };
    // D1 handles auto-increment ID
    const result = await this.db.insert(vocabulary).values(newWord).returning().get();
    return result;
  }

  async getSyncDeltas(since: number, limit = 500, offset = 0) {
    return this.db.select()
      .from(vocabulary)
      .where(and(
        eq(vocabulary.status, 'published'),
        sql`${vocabulary.updated_at} > ${since}`
      ))
      .orderBy(sql`${vocabulary.updated_at} ASC, ${vocabulary.word} ASC`)
      .limit(limit)
      .offset(offset)
      .all();
  }

  async getCourseSyncDeltas(since: number, limit = 500, offset = 0) {
    const coursesRes = await this.d1.prepare(`
      SELECT id, title, slug, description, thumbnail_url, level, status, created_at, updated_at, is_deleted
      FROM vocab_courses
      WHERE COALESCE(updated_at, 0) > ?
      ORDER BY updated_at ASC, id ASC
      LIMIT ? OFFSET ?
    `).bind(since, limit, offset).all();

    const lessonsRes = await this.d1.prepare(`
      SELECT id, course_id, title, description, order_index, created_at, updated_at, is_deleted
      FROM vocab_course_lessons
      WHERE COALESCE(updated_at, 0) > ?
      ORDER BY updated_at ASC, course_id ASC, order_index ASC
      LIMIT ? OFFSET ?
    `).bind(since, limit, offset).all();

    const mappingsRes = await this.d1.prepare(`
      SELECT cw.id, cw.course_id, cw.lesson_id, cw.vocab_id, v.word, cw.order_index, cw.section, cw.is_featured, cw.updated_at, cw.is_deleted
      FROM vocab_course_words cw
      LEFT JOIN vocabulary v ON v.id = cw.vocab_id
      WHERE COALESCE(cw.updated_at, 0) > ?
      ORDER BY cw.updated_at ASC, cw.course_id ASC, cw.order_index ASC
      LIMIT ? OFFSET ?
    `).bind(since, limit, offset).all();

    return {
      courses: coursesRes.results || [],
      lessons: lessonsRes.results || [],
      course_words: mappingsRes.results || [],
    };
  }

  async searchAdmin(query: string, limit = 50) {
    return this.db.select()
      .from(vocabulary)
      .where(sql`${vocabulary.word} LIKE ${query + '%'}`)
      .limit(limit)
      .all();
  }

  async updateVocabulary(id: number, data: any) {
    const updated = {
      ...data,
      status: 'draft',
      updated_at: Math.floor(Date.now() / 1000)
    };
    await this.db.update(vocabulary).set(updated).where(eq(vocabulary.id, id)).run();
    
    // Clear cache for this word
    const current = await this.db.select({ word: vocabulary.word }).from(vocabulary).where(eq(vocabulary.id, id)).get();
    if (current && this.cache) {
      await this.cache.delete(`vocab:word:${current.word}`);
    }
    
    return this.db.select().from(vocabulary).where(eq(vocabulary.id, id)).get();
  }

  async publishAll() {
    const now = Math.floor(Date.now() / 1000);
    await this.db.update(vocabulary)
      .set({ status: 'published', updated_at: now })
      .where(eq(vocabulary.status, 'draft'))
      .run();

    const countRow = await this.db.select({ count: sql<number>`count(*)` })
      .from(vocabulary)
      .where(and(eq(vocabulary.status, 'published'), eq(vocabulary.is_deleted, 0)))
      .get();
    const wordCount = Number(countRow?.count || 0);
    const version = `v${now}`;

    await this.db.insert(dictionaryReleases).values({
      id: crypto.randomUUID(),
      version,
      word_count: wordCount,
      status: 'published',
      notes: 'Admin publish',
      published_at: new Date(now * 1000),
    }).run();

    return { version: now, release_version: version, word_count: wordCount };
  }

  async deleteVocabulary(id: string) {
    const now = Math.floor(Date.now() / 1000);
    await this.db.update(vocabulary)
      .set({ is_deleted: 1, updated_at: now, status: 'published' })
      .where(eq(vocabulary.id, Number(id)))
      .run();
    return { success: true };
  }

  private async clearBulkVocabularyCache(vocab_course_id: string, words: { word: string }[]) {
    if (!this.cache) return;

    const listKeys = [
      `vocab:${vocab_course_id}:all:all:all:all:all:all:0`,
      `vocab:${vocab_course_id}:all:all:all:all:all:2000:0`,
      `vocab:${vocab_course_id}:all:all:all:all:all:200000:0`,
      `vocab:all:all:all:all:all:all:all:0`,
    ];
    const wordKeys = words.map((w) => `vocab:word:${w.word}`);
    await Promise.all([...listKeys, ...wordKeys].map((key) => this.cache!.delete(key)));
  }

  private normalizeBulkWord(vocab_course_id: string, item: any, now: number) {
    const word = String(item?.word || '').trim();
    if (!word) throw new Error('Missing word');

    return {
      vocab_course_id,
      word,
      definition: item.definition ?? '',
      definition_vi: item.definition_vi ?? '',
      example: item.example ?? '',
      example_vi: item.example_vi ?? '',
      topic: item.topic || 'General',
      pronunciation: item.pronunciation ?? '',
      part_of_speech: item.part_of_speech || 'N',
      synonyms: item.synonyms ? JSON.stringify(item.synonyms) : null,
      antonyms: item.antonyms ? JSON.stringify(item.antonyms) : null,
      level: item.level || 'A1',
      is_priority: item.is_priority ? 1 : 0,
      is_academic: item.is_academic ? 1 : 0,
      status: item.status || 'published',
      updated_at: now,
      is_deleted: 0,
    };
  }

  async bulkImportVocabulary(vocab_course_id: string, words: any[]) {
    if (!vocab_course_id) throw new Error('vocab_course_id is required');
    if (!Array.isArray(words)) throw new Error('words must be an array');

    const now = Math.floor(Date.now() / 1000);
    const errors: { index: number; word?: string; message: string }[] = [];
    const normalized = words.flatMap((item, index) => {
      try {
        return [this.normalizeBulkWord(vocab_course_id, item, now)];
      } catch (error: any) {
        errors.push({ index, word: item?.word, message: error?.message || 'Invalid word' });
        return [];
      }
    });

    const sql = `
      INSERT INTO vocabulary (
        vocab_course_id, word, definition, definition_vi, example, example_vi, topic,
        pronunciation, part_of_speech, synonyms, antonyms, level, is_priority,
        is_academic, status, updated_at, is_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(word) DO UPDATE SET
        vocab_course_id = excluded.vocab_course_id,
        definition = excluded.definition,
        definition_vi = excluded.definition_vi,
        example = excluded.example,
        example_vi = excluded.example_vi,
        topic = excluded.topic,
        pronunciation = excluded.pronunciation,
        part_of_speech = excluded.part_of_speech,
        synonyms = excluded.synonyms,
        antonyms = excluded.antonyms,
        level = excluded.level,
        is_priority = excluded.is_priority,
        is_academic = excluded.is_academic,
        status = excluded.status,
        updated_at = excluded.updated_at,
        is_deleted = 0
    `;

    const statements = normalized.map((w) => this.d1.prepare(sql).bind(
      w.vocab_course_id,
      w.word,
      w.definition,
      w.definition_vi,
      w.example,
      w.example_vi,
      w.topic,
      w.pronunciation,
      w.part_of_speech,
      w.synonyms,
      w.antonyms,
      w.level,
      w.is_priority,
      w.is_academic,
      w.status,
      w.updated_at,
      w.is_deleted,
    ));

    try {
      if (statements.length > 0) await this.d1.batch(statements);
    } catch {
      errors.length = 0;
      let imported = 0;
      for (let i = 0; i < normalized.length; i += 1) {
        const w = normalized[i];
        try {
          await this.d1.prepare(sql).bind(
            w.vocab_course_id,
            w.word,
            w.definition,
            w.definition_vi,
            w.example,
            w.example_vi,
            w.topic,
            w.pronunciation,
            w.part_of_speech,
            w.synonyms,
            w.antonyms,
            w.level,
            w.is_priority,
            w.is_academic,
            w.status,
            w.updated_at,
            w.is_deleted,
          ).run();
          imported += 1;
        } catch (error: any) {
          errors.push({ index: i, word: w.word, message: error?.message || 'Failed to import' });
        }
      }
      await this.clearBulkVocabularyCache(vocab_course_id, normalized);
      return { count: imported, failed: errors.length, errors: errors.slice(0, 20) };
    }

    await this.clearBulkVocabularyCache(vocab_course_id, normalized);
    return { count: normalized.length, failed: errors.length, errors: errors.slice(0, 20) };
  }
}
