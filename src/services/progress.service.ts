import { D1Database } from '@cloudflare/workers-types';
import { drizzle } from 'drizzle-orm/d1';
import { userProgress, questions, lessons, passages, questionGroups, submissions, users } from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { AIService } from './ai.service';

export class ProgressService {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  /**
   * Lấy tiến trình học tập của user cho một lesson cụ thể
   */
  async getProgress(userId: string, lessonId: string) {
    // Đảm bảo user tồn tại (vì mình chưa làm Auth)
    const user = await this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user && userId === 'test-user-id') {
      await this.db.insert(users).values({
        id: 'test-user-id',
        email: 'test@example.com',
        full_name: 'Test Student'
      }).run();
    }

    return await this.db.select()
      .from(userProgress)
      .where(
        and(
          eq(userProgress.user_id, userId), 
          eq(userProgress.lesson_id, lessonId)
        )
      )
      .get();
  }

  /**
   * Lưu bản nháp (draft) khi user đang làm bài
   */
  async saveDraft(userId: string, lessonId: string, draftAnswers: any, timeLeft: number) {
    const existing = await this.getProgress(userId, lessonId);

    if (existing) {
      return await this.db.update(userProgress)
        .set({
          draft_answers: draftAnswers,
          time_left: timeLeft,
          status: 'in_progress',
          updated_at: new Date()
        })
        .where(eq(userProgress.id, existing.id))
        .returning()
        .get();
    }

    return await this.db.insert(userProgress)
      .values({
        id: crypto.randomUUID(),
        user_id: userId,
        lesson_id: lessonId,
        draft_answers: draftAnswers,
        time_left: timeLeft,
        status: 'in_progress'
      })
      .returning()
      .get();
  }

  /**
   * Hoàn thành bài học và lưu điểm số
   */
  async completeLesson(userId: string, lessonId: string, stats: { score: number, total: number, correct: number }) {
    const existing = await this.getProgress(userId, lessonId);
    const now = new Date();

    const data = {
      status: 'completed' as const,
      score: stats.score,
      total_questions: stats.total,
      correct_answers: stats.correct,
      completed_at: now,
      updated_at: now
    };

    if (existing) {
      return await this.db.update(userProgress)
        .set(data)
        .where(eq(userProgress.id, existing.id))
        .returning()
        .get();
    }

    return await this.db.insert(userProgress)
      .values({
        id: crypto.randomUUID(),
        user_id: userId,
        lesson_id: lessonId,
        ...data
      })
      .returning()
      .get();
  }

  /**
   * Chấm điểm và hoàn thành bài thi
   */
  async submitAndScore(
    userId: string, 
    lessonId: string, 
    answers: { question_id: string, answer: string }[],
    ai: any
  ) {
    const aiService = new AIService(ai);

    // 1. Lấy thông tin lesson và questions
    const lesson = await this.db.select().from(lessons).where(eq(lessons.id, lessonId)).get();
    if (!lesson) {
      throw new Error(`Lesson with ID ${lessonId} not found`);
    }

    const allQuestions = await this.db.select().from(questions).where(eq(questions.lesson_id, lessonId)).all();
    const allPassages = await this.db.select().from(passages).where(eq(passages.lesson_id, lessonId)).all();

    let totalScore = 0;
    let correctCount = 0;
    const results = [];

    if (lesson.lesson_type === 'writing') {
      // CHẤM ĐIỂM WRITING BẰNG AI
      const submissionRows = [];
      for (const studentAns of answers) {
        const passage = allPassages[0];
        const aiResult = await aiService.gradeWriting(passage?.content_html || '', studentAns.answer);

        results.push({
          question_id: studentAns.question_id,
          answer: studentAns.answer,
          is_correct: true,
          score: aiResult.overall_score,
          feedback: aiResult
        });

        submissionRows.push({
          id: crypto.randomUUID(),
          user_id: userId,
          question_id: studentAns.question_id,
          answer_text: studentAns.answer,
          status: 'completed',
          score: aiResult.overall_score,
          feedback: aiResult
        });

        totalScore += aiResult.overall_score;
        correctCount++;
      }

      // B2: Batch insert — 1 query thay vì N queries
      if (submissionRows.length > 0) {
        await this.db.insert(submissions).values(submissionRows).run();
      }

      totalScore = totalScore / (answers.length || 1);
    } else {
      // CHẤM ĐIỂM READING/LISTENING TỰ ĐỘNG
      const submissionRows = [];
      for (const studentAns of answers) {
        const q = allQuestions.find(item => item.id === studentAns.question_id);
        const isCorrect = q?.correct_answer?.toLowerCase().trim() === studentAns.answer?.toLowerCase().trim();

        if (isCorrect) correctCount++;

        results.push({
          question_id: studentAns.question_id,
          answer: studentAns.answer,
          is_correct: isCorrect,
          correct_answer: q?.correct_answer
        });

        submissionRows.push({
          id: crypto.randomUUID(),
          user_id: userId,
          question_id: studentAns.question_id,
          answer_text: studentAns.answer,
          status: 'completed',
          score: isCorrect ? 1 : 0
        });
      }

      // B2: Batch insert — 1 query thay vì N queries
      if (submissionRows.length > 0) {
        await this.db.insert(submissions).values(submissionRows).run();
      }

      totalScore = (correctCount / (allQuestions.length || 1)) * 100;
    }

    // 2. Lưu kết quả tổng quát
    const progress = await this.completeLesson(userId, lessonId, {
      score: totalScore,
      total: allQuestions.length,
      correct: correctCount
    });

    return {
      ...progress,
      results
    };
  }
}
