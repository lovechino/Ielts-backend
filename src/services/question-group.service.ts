import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { questionGroups } from '../db/schema';
import type { D1Database } from '@cloudflare/workers-types';

export class QuestionGroupService {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  async getByLesson(lesson_id: string) {
    return await this.db.select().from(questionGroups).where(eq(questionGroups.lesson_id, lesson_id)).orderBy(questionGroups.order);
  }

  async getByPassage(passage_id: string) {
    return await this.db.select().from(questionGroups).where(eq(questionGroups.passage_id, passage_id)).orderBy(questionGroups.order);
  }

  async getById(id: string) {
    const result = await this.db.select().from(questionGroups).where(eq(questionGroups.id, id)).limit(1);
    return result[0] || null;
  }

  async create(data: any) {
    const result = await this.db.insert(questionGroups).values({
      id: data.id || crypto.randomUUID(),
      lesson_id: data.lesson_id || data.lessonId,
      passage_id: data.passage_id || data.passageId,
      title: data.title,
      instruction: data.instruction,
      group_type: data.group_type || data.groupType,
      order: data.order || 0
    }).returning();
    return result[0];
  }

  async update(id: string, data: any) {
    const updateData = { ...data };
    delete updateData.id;
    
    // Normalize field names
    if (updateData.lessonId) {
      updateData.lesson_id = updateData.lessonId;
      delete updateData.lessonId;
    }
    if (updateData.passageId) {
      updateData.passage_id = updateData.passageId;
      delete updateData.passageId;
    }
    if (updateData.groupType) {
      updateData.group_type = updateData.groupType;
      delete updateData.groupType;
    }

    const result = await this.db.update(questionGroups)
      .set(updateData)
      .where(eq(questionGroups.id, id))
      .returning();
    return result[0];
  }

  async delete(id: string) {
    return await this.db.delete(questionGroups).where(eq(questionGroups.id, id)).returning();
  }
}
