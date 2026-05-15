import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { courses } from '../db/schema';
import type { D1Database } from '@cloudflare/workers-types';
import type { KVNamespace } from '@cloudflare/workers-types';

const CACHE_TTL = 300; // 5 minutes

export class CourseService {
  private db;
  private cache: KVNamespace | null;

  constructor(d1: D1Database, cache?: KVNamespace) {
    this.db = drizzle(d1);
    this.cache = cache || null;
  }

  async getAll() {
    const cacheKey = 'courses:all';

    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }

    const result = await this.db.select().from(courses);

    if (this.cache) {
      await this.cache.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL });
    }

    return result;
  }

  async getById(courseId: string) {
    const cacheKey = `courses:${courseId}`;

    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }

    const result = await this.db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    const course = result[0] || null;

    if (this.cache && course) {
      await this.cache.put(cacheKey, JSON.stringify(course), { expirationTtl: CACHE_TTL });
    }

    return course;
  }

  async create(data: any) {
    const insertData = {
      id: crypto.randomUUID(),
      ...data,
      thumbnail_url: data.thumbnail_url || data.thumbnailUrl,
    };
    delete (insertData as any).thumbnailUrl;

    const result = await this.db.insert(courses).values(insertData).returning();

    // Invalidate list cache on write
    if (this.cache) {
      await this.cache.delete('courses:all');
    }

    return result[0];
  }
}
