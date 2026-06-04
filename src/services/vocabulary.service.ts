import { drizzle } from 'drizzle-orm/d1';
import { vocabulary, vocabCourses } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { D1Database } from '@cloudflare/workers-types';
import type { KVNamespace } from '@cloudflare/workers-types';

const CACHE_TTL = 3600; // 1 hour — vocabulary is very static

export class VocabularyService {
  private db;
  private cache: KVNamespace | null;

  constructor(d1: D1Database, cache?: KVNamespace) {
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
    offset?: number 
  } = {}) {
    const cacheKey = `vocab:${params.vocab_course_id || 'all'}:${params.level || 'all'}:${params.topic || 'all'}:${params.structure_type || 'all'}:${params.is_priority ?? 'all'}:${params.is_academic ?? 'all'}:${params.limit || 'all'}:${params.offset || 0}`;
    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }
    const conditions = [];
    if (params.level) conditions.push(eq(vocabulary.level, params.level));
    if (params.topic) conditions.push(eq(vocabulary.topic, params.topic));
    if (params.vocab_course_id) conditions.push(eq(vocabulary.vocab_course_id, params.vocab_course_id));
    
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
    return this.db.select().from(vocabCourses).all();
  }

  async createCourse(data: { title: string; slug: string; description?: string; thumbnail_url?: string }) {
    const id = crypto.randomUUID();
    await this.db.insert(vocabCourses).values({ id, ...data }).run();
    return { id, ...data };
  }

  async updateCourse(id: string, data: any) {
    await this.db.update(vocabCourses).set(data).where(eq(vocabCourses.id, id)).run();
    return this.db.select().from(vocabCourses).where(eq(vocabCourses.id, id)).get();
  }

  async deleteCourse(id: string) {
    await this.db.delete(vocabCourses).where(eq(vocabCourses.id, id)).run();
    return { success: true };
  }

  async upsertVocabulary(data: any) {
    const existing = await this.db.select().from(vocabulary).where(eq(vocabulary.word, data.word)).get();
    if (existing) {
      await this.db.update(vocabulary).set(data).where(eq(vocabulary.id, existing.id)).run();
      return { ...existing, ...data };
    }
    const id = crypto.randomUUID();
    const newWord = { id, ...data };
    await this.db.insert(vocabulary).values(newWord).run();
    return newWord;
  }

  async deleteVocabulary(id: string) {
    await this.db.delete(vocabulary).where(eq(vocabulary.id, Number(id))).run();
    return { success: true };
  }

  async bulkImportVocabulary(vocab_course_id: string, words: any[]) {
    for (const item of words) {
      await this.upsertVocabulary({ ...item, vocab_course_id });
    }
    return { count: words.length };
  }
}
