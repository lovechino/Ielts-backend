import { eq, sql, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { lessons } from '../db/schema';
import type { D1Database } from '@cloudflare/workers-types';

import { PassageService } from './passage.service';
import { QuestionGroupService } from './question-group.service';

export class LessonService {
  private db;
  private d1_raw: D1Database;

  constructor(d1: D1Database) {
    this.d1_raw = d1;
    this.db = drizzle(d1);
  }

  async getByCourse(course_id: string) {
    return await this.db.select().from(lessons).where(eq(lessons.course_id, course_id));
  }

  async getTests(testType?: string) {
    const conditions = [eq(lessons.is_test, true)];
    if (testType) {
      conditions.push(eq(lessons.test_type, testType as any));
    }
    
    return await this.db.select().from(lessons).where(and(...conditions));
  }

  async getById(lessonId: string) {
    const result = await this.db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
    if (result.length === 0) return null;
    
    const lesson = result[0];
    
    // Fetch nested data
    const passageService = new PassageService(this.d1_raw);
    const qgService = new QuestionGroupService(this.d1_raw);
    
    const passages = await passageService.getByLesson(lessonId);
    const groups = await qgService.getByLesson(lessonId);
    
    return {
      ...lesson,
      passages,
      question_groups: groups
    };
  }

  async create(data: any) {
    const insertData = this.mapLessonData(data);
    const result = await this.db.insert(lessons).values(insertData).returning();
    return result[0];
  }

  async createMany(items: any[]) {
    const insertData = items.map(item => this.mapLessonData(item));
    const result = await this.db.insert(lessons).values(insertData).returning();
    return result;
  }

  async update(lessonId: string, data: any) {
    const updateData = {
      ...data,
      course_id: data.course_id || data.courseId,
      lesson_type: data.lesson_type || data.lessonType,
      pdf_url: data.pdf_url || data.pdfUrl,
    };
    // Clean up
    delete (updateData as any).id;
    delete (updateData as any).courseId;
    delete (updateData as any).lessonType;
    delete (updateData as any).pdfUrl;

    const result = await this.db.update(lessons)
      .set(updateData)
      .where(eq(lessons.id, lessonId))
      .returning();
    return result[0];
  }

  private mapLessonData(data: any) {
    const mapped = {
      id: data.id || crypto.randomUUID(),
      course_id: data.course_id || data.courseId,
      title: data.title,
      content: data.content,
      order: data.order || 0,
      lesson_type: data.lesson_type || data.lessonType,
      pdf_url: data.pdf_url || data.pdfUrl,
      is_test: data.is_test ?? false,
      test_type: data.test_type || 'practice',
      time_limit: data.time_limit || 60,
    };
    return mapped;
  }
}
