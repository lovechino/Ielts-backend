import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { passages } from '../db/schema';
import type { D1Database } from '@cloudflare/workers-types';

export class PassageService {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  async getByLesson(lesson_id: string) {
    return await this.db.select().from(passages).where(eq(passages.lesson_id, lesson_id)).orderBy(passages.order);
  }

  async getById(id: string) {
    const result = await this.db.select().from(passages).where(eq(passages.id, id)).limit(1);
    return result[0] || null;
  }

  async create(data: any) {
    const result = await this.db.insert(passages).values({
      id: data.id || crypto.randomUUID(),
      lesson_id: data.lesson_id || data.lessonId,
      title: data.title,
      content_html: data.content_html || data.contentHtml,
      order: data.order || 0
    }).returning();
    return result[0];
  }

  async update(id: string, data: any) {
    const updateData = { ...data };
    delete updateData.id;
    
    // Normalize field names if needed
    if (updateData.lessonId) {
      updateData.lesson_id = updateData.lessonId;
      delete updateData.lessonId;
    }
    if (updateData.contentHtml) {
      updateData.content_html = updateData.contentHtml;
      delete updateData.contentHtml;
    }

    const result = await this.db.update(passages)
      .set(updateData)
      .where(eq(passages.id, id))
      .returning();
    return result[0];
  }

  async delete(id: string) {
    return await this.db.delete(passages).where(eq(passages.id, id)).returning();
  }
}
