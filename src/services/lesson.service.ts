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
    
    // Select specific columns to be safe and efficient
    return await this.db.select({
      id: lessons.id,
      course_id: lessons.course_id,
      title: lessons.title,
      order: lessons.order,
      lesson_type: lessons.lesson_type,
      pdf_url: lessons.pdf_url,
      is_test: lessons.is_test,
      test_type: lessons.test_type,
      time_limit: lessons.time_limit,
      speaking_part: lessons.speaking_part,
    })
    .from(lessons)
    .where(and(...conditions))
    .all();
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
    // Defense against corrupted JSON fields
    let lessonParts = data.lesson_parts !== undefined ? data.lesson_parts : (data.lessonParts !== undefined ? data.lessonParts : undefined);
    if (typeof lessonParts === 'string') {
      try {
        if (lessonParts === 'lesson_parts') {
          lessonParts = null;
        } else {
          lessonParts = JSON.parse(lessonParts);
        }
      } catch {
        lessonParts = null;
      }
    }

    let metadata = data.metadata;
    if (typeof metadata === 'string') {
      try {
        if (metadata === 'metadata') {
          metadata = null;
        } else {
          metadata = JSON.parse(metadata);
        }
      } catch {
        metadata = null;
      }
    }

    const updateData: any = {
      ...data,
      course_id: data.course_id || data.courseId,
      lesson_type: data.lesson_type || data.lessonType,
      pdf_url: data.pdf_url || data.pdfUrl,
      speaking_part: data.speaking_part !== undefined ? data.speaking_part : (data.speakingPart !== undefined ? data.speakingPart : undefined),
    };

    if (lessonParts !== undefined) updateData.lesson_parts = lessonParts;
    if (metadata !== undefined) updateData.metadata = metadata;

    // Clean up
    delete updateData.id;
    delete updateData.courseId;
    delete updateData.lessonType;
    delete updateData.pdfUrl;
    delete updateData.speakingPart;
    delete updateData.lessonParts;

    const result = await this.db.update(lessons)
      .set(updateData)
      .where(eq(lessons.id, lessonId))
      .returning();
    return result[0];
  }

  private mapLessonData(data: any) {
    // Defense against corrupted JSON fields
    let lessonParts = data.lesson_parts || data.lessonParts || null;
    if (typeof lessonParts === 'string') {
      try {
        if (lessonParts === 'lesson_parts') {
          lessonParts = null;
        } else {
          lessonParts = JSON.parse(lessonParts);
        }
      } catch {
        lessonParts = null;
      }
    }

    let metadata = data.metadata || null;
    if (typeof metadata === 'string') {
      try {
        if (metadata === 'metadata') {
          metadata = null;
        } else {
          metadata = JSON.parse(metadata);
        }
      } catch {
        metadata = null;
      }
    }

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
      speaking_part: data.speaking_part || data.speakingPart || null,
      lesson_parts: lessonParts,
      metadata: metadata,
    };
    return mapped;
  }

  async delete(lessonId: string) {
    const result = await this.db.delete(lessons)
      .where(eq(lessons.id, lessonId))
      .returning();
    return result.length > 0;
  }
}
