import { drizzle } from 'drizzle-orm/d1';
import { vocabulary } from '../db/schema';
import { eq, and } from 'drizzle-orm';
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

  /**
   * Lấy danh sách từ vựng với filter, kết quả được cache 1 giờ
   */
  async getAll(params: { level?: string; topic?: string; limit?: number; offset?: number } = {}) {
    const cacheKey = `vocab:${params.level || 'all'}:${params.topic || 'all'}:${params.limit || 100}:${params.offset || 0}`;

    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }

    const conditions = [];
    if (params.level) conditions.push(eq(vocabulary.level, params.level));
    if (params.topic) conditions.push(eq(vocabulary.topic, params.topic));

    let query = this.db.select().from(vocabulary).$dynamic();
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const result = await query
      .limit(params.limit || 100)
      .offset(params.offset || 0)
      .all();

    if (this.cache) {
      await this.cache.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL });
    }

    return result;
  }

  /**
   * Tìm từ vựng theo từ khóa
   */
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
}
