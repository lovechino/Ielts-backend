import { D1Database } from '@cloudflare/workers-types';
import { drizzle } from 'drizzle-orm/d1';
import { userProgress, questions, lessons, passages, submissions, users, questionGroups } from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { AIService } from './ai.service';
import { sendPushNotification } from './push.service';

// Delay cho free user: 7 phút Writing, 2 phút Reading/Listening
const FREE_WRITING_DELAY_MS  = 7 * 60 * 1000;
const FREE_READING_DELAY_MS  = 2 * 60 * 1000;

export class ProgressService {
  private db;
  private d1: D1Database;

  constructor(d1: D1Database) {
    this.d1 = d1;
    this.db = drizzle(d1);
  }

  async getProgress(userId: string, lessonId: string) {
    const progress = await this.db.select()
      .from(userProgress)
      .where(and(eq(userProgress.user_id, userId), eq(userProgress.lesson_id, lessonId)))
      .get();

    if (progress && progress.status === 'completed') {
      const lessonQuestions = await this.db.select()
        .from(questions)
        .where(eq(questions.lesson_id, lessonId))
        .all();

      const questionIds = lessonQuestions.map(q => q.id);
      if (questionIds.length > 0) {
        const userSubmissions = await this.db.select()
          .from(submissions)
          .where(and(eq(submissions.user_id, userId), inArray(submissions.question_id, questionIds)))
          .all();

        const results = userSubmissions.map(s => {
          const q = lessonQuestions.find(item => item.id === s.question_id);
          return {
            question_id: s.question_id,
            answer: s.answer_text,
            is_correct: s.score !== null ? s.score > 0 : true,
            correct_answer: q?.correct_answer ?? undefined,
            score: s.score ?? undefined,
            feedback: s.feedback
              ? (typeof s.feedback === 'string' ? JSON.parse(s.feedback) : s.feedback)
              : undefined,
          };
        });

        return { ...progress, results };
      }
    }

    return progress;
  }

  async saveDraft(userId: string, lessonId: string, draftAnswers: any, timeLeft: number) {
    const existing = await this.getProgress(userId, lessonId);

    if (existing) {
      return await this.db.update(userProgress)
        .set({ draft_answers: draftAnswers, time_left: timeLeft, status: 'in_progress', updated_at: new Date() })
        .where(eq(userProgress.id, existing.id))
        .returning().get();
    }

    return await this.db.insert(userProgress)
      .values({ id: crypto.randomUUID(), user_id: userId, lesson_id: lessonId, draft_answers: draftAnswers, time_left: timeLeft, status: 'in_progress' })
      .returning().get();
  }

  async completeLesson(userId: string, lessonId: string, stats: { score: number; total: number; correct: number }) {
    const existing = await this.getProgress(userId, lessonId);
    const now = new Date();
    
    // Check if reward already claimed
    const shouldAward = !existing || !existing.reward_claimed;
    const LESSON_REWARD = 100;

    const data: any = {
      status: 'completed' as const,
      score: stats.score,
      total_questions: stats.total,
      correct_answers: stats.correct,
      completed_at: now,
      updated_at: now,
    };

    if (shouldAward) {
      data.reward_claimed = true;
      // Award coins to user
      await this.db.update(users)
        .set({ 
          coins: sql`${users.coins} + ${LESSON_REWARD}`,
          updated_at: now 
        })
        .where(eq(users.id, userId))
        .run();
    }

    let progress: any;
    if (existing) {
      progress = await this.db.update(userProgress).set(data).where(eq(userProgress.id, existing.id)).returning().get();
    } else {
      progress = await this.db.insert(userProgress)
        .values({ id: crypto.randomUUID(), user_id: userId, lesson_id: lessonId, ...data })
        .returning().get();
    }

    return {
      ...progress,
      reward_issued: shouldAward,
      coins_awarded: shouldAward ? LESSON_REWARD : 0
    };
  }

  /**
   * Submit và chấm điểm.
   * - Writing (free): AI background, kết quả sau 7 phút
   * - Writing (premium): kết quả ngay
   * - Reading/Listening (free): chấm ngay nhưng delay hiển thị 2 phút
   * - Reading/Listening (premium): kết quả ngay
   */
  async submitAndScore(
    userId: string,
    lessonId: string,
    answers: { question_id: string; answer: string }[],
    env: any,
    executionCtx?: { waitUntil: (p: Promise<any>) => void }
  ) {
    const lesson = await this.db.select().from(lessons).where(eq(lessons.id, lessonId)).get();
    if (!lesson) throw new Error(`Lesson with ID ${lessonId} not found`);

    const user = await this.db.select().from(users).where(eq(users.id, userId)).get();
    const isPremium = user?.tier === 'premium';
    const isWriting = lesson.lesson_type === 'writing';

    // Free + Writing → AI background, delay 7 phút
    if (isWriting && !isPremium) {
      return await this._submitWritingDeferred(userId, lessonId, answers, env, user, executionCtx);
    }

    // Chấm ngay (premium tất cả, hoặc free reading/listening)
    const result = await this._submitAndScoreImmediate(userId, lessonId, answers, env.AI, user, lesson);

    // Free + Reading/Listening → delay hiển thị 2 phút
    if (!isPremium && !isWriting) {
      const resultAvailableAt = new Date(Date.now() + FREE_READING_DELAY_MS);
      await this.db.update(userProgress)
        .set({ result_available_at: resultAvailableAt, updated_at: new Date() })
        .where(and(eq(userProgress.user_id, userId), eq(userProgress.lesson_id, lessonId)))
        .run();

      // Push notification sau 2 phút (best-effort qua waitUntil)
      if (executionCtx) {
        executionCtx.waitUntil(
          sendPushNotification(this.d1, userId, {
            title: '✅ Kết quả bài kiểm tra đã sẵn sàng',
            body: 'Vào mục Lịch sử để xem kết quả.',
            data: { type: 'scoring_complete', lesson_id: lessonId },
          })
        );
      }

      return {
        ...result,
        scoring_mode: 'deferred',
        result_available_at: resultAvailableAt.toISOString(),
        estimated_wait_minutes: Math.ceil(FREE_READING_DELAY_MS / 60000),
        message: `Kết quả sẽ xuất hiện trong mục Lịch sử sau khoảng ${Math.ceil(FREE_READING_DELAY_MS / 60000)} phút.`,
      };
    }

    return result;
  }

  // ─── Deferred scoring (free + writing) ────────────────────────────────────

  private async _submitWritingDeferred(
    userId: string,
    lessonId: string,
    answers: { question_id: string; answer: string }[],
    env: any,
    user: any,
    executionCtx?: { waitUntil: (p: Promise<any>) => void }
  ) {
    const now = new Date();
    const resultAvailableAt = new Date(now.getTime() + FREE_WRITING_DELAY_MS);

    // 1. Lưu submissions với status='pending'
    const submissionRows = answers.map(a => ({
      id: crypto.randomUUID(),
      user_id: userId,
      question_id: a.question_id,
      answer_text: a.answer,
      status: 'pending' as const,
    }));
    if (submissionRows.length > 0) {
      await this.db.insert(submissions).values(submissionRows).run();
    }

    // 2. Lưu progress với scoring_status='pending'
    const existing = await this.db.select().from(userProgress)
      .where(and(eq(userProgress.user_id, userId), eq(userProgress.lesson_id, lessonId)))
      .get();

    const progressData = {
      status: 'completed' as const,
      scoring_status: 'pending' as const,
      completed_at: now,
      result_available_at: resultAvailableAt,
      updated_at: now,
    };

    let savedProgress: any;
    if (existing) {
      savedProgress = await this.db.update(userProgress)
        .set(progressData)
        .where(eq(userProgress.id, existing.id))
        .returning().get();
    } else {
      savedProgress = await this.db.insert(userProgress)
        .values({ id: crypto.randomUUID(), user_id: userId, lesson_id: lessonId, ...progressData })
        .returning().get();
    }

    // 3. Đưa task vào Queue
    if (env.SCORING_QUEUE) {
      const queueMsg = {
        userId,
        lessonId,
        answers,
        persona: user?.ai_persona || 'james',
        progressId: savedProgress.id,
        resultAvailableAt: resultAvailableAt.toISOString(),
      };
      await env.SCORING_QUEUE.send(queueMsg);
    } else {
      console.warn('SCORING_QUEUE not bound, falling back to waitUntil');
      const scoringTask = this.runBackgroundScoring(userId, lessonId, answers, env.AI, user, savedProgress.id, new Date(resultAvailableAt));
      if (executionCtx) {
        executionCtx.waitUntil(scoringTask);
      } else {
        scoringTask.catch(console.error);
      }
    }

    // 4. Trả về ngay — không chờ AI
    return {
      ...savedProgress,
      scoring_mode: 'deferred',
      result_available_at: resultAvailableAt.toISOString(),
      estimated_wait_minutes: Math.ceil(FREE_WRITING_DELAY_MS / 60000),
      message: `Bài viết đã được nộp. Kết quả sẽ xuất hiện trong mục Lịch sử sau khoảng ${Math.ceil(FREE_WRITING_DELAY_MS / 60000)} phút.`,
    };
  }

  public async runBackgroundScoring(
    userId: string,
    lessonId: string,
    answers: { question_id: string; answer: string }[],
    ai: any,
    user: any,
    progressId: string,
    resultAvailableAt: Date
  ): Promise<void> {
    try {
      const aiService = new AIService(ai);
      const allPassages = await this.db.select().from(passages).where(eq(passages.lesson_id, lessonId)).all();
      const allGroups = await this.db.select().from(questionGroups).where(eq(questionGroups.lesson_id, lessonId)).all();
      const allQuestions = await this.db.select().from(questions).where(eq(questions.lesson_id, lessonId)).all();
      const persona = user?.ai_persona || 'james';

      const tasksToGrade = answers.map((studentAns, i) => {
        const question = allQuestions.find(q => q.id === studentAns.question_id);
        const group = allGroups.find(g => g.id === question?.group_id);
        const passage = allPassages.find(p => p.id === group?.passage_id) || allPassages[0];
        // Assuming title indicates TASK1 or TASK2 or similar. If not, just pass 'writing_task'
        const taskType = passage?.title?.toUpperCase().includes('TASK 1') ? 'TASK1' : (passage?.title?.toUpperCase().includes('TASK 2') ? 'TASK2' : 'TASK');
        return {
          question_id: studentAns.question_id,
          task_prompt: passage?.content_html || '',
          student_answer: studentAns.answer,
          task_type: taskType,
          originalIndex: i
        };
      });

      const aiResult = await aiService.gradeWritingBatch(tasksToGrade, persona);
      let avgScore = 0;
      const submissionUpdates: Array<{ id: string; score: number; feedback: any }> = [];

      if (aiResult.success && aiResult.data && aiResult.data.tasks_results) {
        avgScore = aiResult.data.combined_score || 0;
        
        for (let i = 0; i < tasksToGrade.length; i++) {
          const studentAns = answers[i];
          // Llama returns tasks_results in the same order as input tasks
          const taskRes = aiResult.data.tasks_results[i];
          if (!taskRes) continue;

          // map from new schema to old schema to avoid breaking UI
          const oldSchemaFeedback = {
            overall_score: taskRes.overall_score,
            criteria_scores: taskRes.criteria_scores,
            detailed_errors: taskRes.detailed_errors,
            sample_rewrite_segments: taskRes.sample_rewrite_segments,
            suggested_version: taskRes.suggested_version,
            word_count: taskRes.word_count,
            feedback: `${taskRes.user_feedback_vi?.weaknesses || ""}. ${taskRes.user_feedback_vi?.action_plan || ""}`
          };

          const sub = await this.db.select({ id: submissions.id })
            .from(submissions)
            .where(and(
              eq(submissions.user_id, userId),
              eq(submissions.question_id, studentAns.question_id),
              eq(submissions.status, 'pending')
            ))
            .get();

          if (sub) {
            submissionUpdates.push({ id: sub.id, score: oldSchemaFeedback.overall_score, feedback: oldSchemaFeedback });
          }
        }
      } else {
        console.error("Batch grading failed", aiResult.error);
      }

      // Update submissions
      for (const upd of submissionUpdates) {
        await this.db.update(submissions)
          .set({ status: 'completed', score: upd.score, feedback: upd.feedback })
          .where(eq(submissions.id, upd.id))
          .run();
      }

      // Update progress với kết quả đầy đủ
      // preview_score = band score tổng (luôn hiện cho free)
      // score = band score tổng (dùng để sort/filter)
      // full_result_unlocked = false (cần xem ads để unlock chi tiết)
      await this.db.update(userProgress)
        .set({
          scoring_status: 'completed',
          score: avgScore,
          preview_score: avgScore,
          total_questions: answers.length,
          correct_answers: answers.length,
          full_result_unlocked: false,
          updated_at: new Date(),
        })
        .where(eq(userProgress.id, progressId))
        .run();

      // Gửi push notification
      await sendPushNotification(this.d1, userId, {
        title: '✅ Kết quả bài viết đã sẵn sàng',
        body: `Band score: ${avgScore.toFixed(1)}/9.0. Vào mục Lịch sử để xem chi tiết.`,
        data: { type: 'scoring_complete', lesson_id: lessonId },
      });

    } catch (err) {
      console.error('[scoring] Background scoring failed:', err);
      await this.db.update(userProgress)
        .set({ scoring_status: 'failed', updated_at: new Date() })
        .where(eq(userProgress.id, progressId))
        .run();

      await sendPushNotification(this.d1, userId, {
        title: '❌ Chấm điểm thất bại',
        body: 'Có lỗi xảy ra. Vui lòng thử nộp lại.',
        data: { type: 'scoring_failed', lesson_id: lessonId },
      });
    }
  }

  // ─── Immediate scoring (premium + reading/listening) ──────────────────────

  private async _submitAndScoreImmediate(
    userId: string,
    lessonId: string,
    answers: { question_id: string; answer: string }[],
    ai: any,
    user: any,
    lesson: any
  ) {
    const aiService = new AIService(ai);
    const allQuestions = await this.db.select().from(questions).where(eq(questions.lesson_id, lessonId)).all();
    const allPassages = await this.db.select().from(passages).where(eq(passages.lesson_id, lessonId)).all();

    let totalScore = 0;
    let correctCount = 0;
    const results = [];

    if (lesson.lesson_type === 'writing') {
      const persona = user?.ai_persona || 'james';
      const submissionRows = [];

      for (const studentAns of answers) {
        const passage = allPassages[0];
        const aiResult = await aiService.gradeWriting(passage?.content_html || '', studentAns.answer, persona);

        results.push({ question_id: studentAns.question_id, answer: studentAns.answer, is_correct: true, score: aiResult.overall_score, feedback: aiResult });
        submissionRows.push({ id: crypto.randomUUID(), user_id: userId, question_id: studentAns.question_id, answer_text: studentAns.answer, status: 'completed', score: aiResult.overall_score, feedback: aiResult });
        totalScore += aiResult.overall_score;
        correctCount++;
      }

      if (submissionRows.length > 0) await this.db.insert(submissions).values(submissionRows).run();
      totalScore = totalScore / (answers.length || 1);
    } else {
      const submissionRows = [];
      for (const studentAns of answers) {
        const q = allQuestions.find(item => item.id === studentAns.question_id);
        const isCorrect = q?.correct_answer?.toLowerCase().trim() === studentAns.answer?.toLowerCase().trim();
        if (isCorrect) correctCount++;
        results.push({ question_id: studentAns.question_id, answer: studentAns.answer, is_correct: isCorrect, correct_answer: q?.correct_answer });
        submissionRows.push({ id: crypto.randomUUID(), user_id: userId, question_id: studentAns.question_id, answer_text: studentAns.answer, status: 'completed', score: isCorrect ? 1 : 0 });
      }
      if (submissionRows.length > 0) await this.db.insert(submissions).values(submissionRows).run();
      totalScore = (correctCount / (allQuestions.length || 1)) * 100;
    }

    const progress = await this.completeLesson(userId, lessonId, { score: totalScore, total: allQuestions.length, correct: correctCount });

    // Premium writing: đánh dấu full_result_unlocked = true ngay
    if (lesson.lesson_type === 'writing') {
      await this.db.update(userProgress)
        .set({ scoring_status: 'completed', full_result_unlocked: true, preview_score: totalScore, updated_at: new Date() })
        .where(eq(userProgress.id, progress!.id))
        .run();
    }

    return { ...progress, results, scoring_mode: 'immediate' };
  }
}
