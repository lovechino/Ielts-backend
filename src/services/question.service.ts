import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { questions } from '../db/schema';
import type { D1Database } from '@cloudflare/workers-types';

export class QuestionService {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  async getByLesson(lesson_id: string) {
    return await this.db.select().from(questions).where(eq(questions.lesson_id, lesson_id));
  }

  async getById(questionId: string) {
    const result = await this.db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
    return result[0] || null;
  }

  async getByGroup(group_id: string) {
    return await this.db.select().from(questions).where(eq(questions.group_id, group_id));
  }

  async create(data: any) {
    const insertData = {
      id: crypto.randomUUID(),
      ...data,
      lesson_id: data.lesson_id || data.lessonId,
      group_id: data.group_id || data.groupId,
      question_type: data.question_type || data.questionType,
      correct_answer: data.correct_answer || data.correctAnswer,
      image_url: data.image_url || data.imageUrl,
      question_format: data.question_format || data.questionFormat,
      scoring_criteria: data.scoring_criteria || data.scoringCriteria,
    };
    // Clean up
    delete (insertData as any).lessonId;
    delete (insertData as any).groupId;
    delete (insertData as any).questionType;
    delete (insertData as any).correctAnswer;
    delete (insertData as any).imageUrl;
    delete (insertData as any).questionFormat;
    delete (insertData as any).scoringCriteria;

    const result = await this.db.insert(questions).values(insertData).returning();
    return result[0];
  }
}
