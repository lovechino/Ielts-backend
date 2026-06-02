import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { streamSSE } from 'hono/streaming';
import { ProgressService } from '../../services/progress.service';
import { Bindings } from '../../index';
import { aiRateLimit } from '../../middleware/rateLimit';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, desc, sql } from 'drizzle-orm';
import { userProgress, lessons, submissions, questions, users, speakingSessions } from '../../db/schema';

const progressRouter = new Hono<{ Bindings: Bindings }>();

progressRouter.use('/*', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  return jwt({ secret, alg: 'HS256' })(c, next);
});

// GET /api/v1/progress/history — lấy mini/full test từ user_progress + speaking_sessions
progressRouter.get('/history', async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;
  const db = drizzle(c.env.DB);

  const type = c.req.query('type'); // 'mini' | 'full' | undefined
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50);
  const offset = parseInt(c.req.query('offset') || '0');

  const user = await db.select({ tier: users.tier }).from(users).where(eq(users.id, userId)).get();
  const isPremium = user?.tier === 'premium';

  // 1. Fetch from userProgress (Reading, Listening, Writing)
  const testConditions: any[] = [
    eq(userProgress.user_id, userId),
    eq(userProgress.status, 'completed'),
    eq(lessons.is_test, true),
  ];
  if (type) testConditions.push(eq(lessons.test_type, type));

  const testRows = await db
    .select({
      id: userProgress.id,
      lesson_id: lessons.id,
      lesson_title: lessons.title,
      lesson_type: lessons.lesson_type,
      test_type: lessons.test_type,
      score: userProgress.score,
      preview_score: userProgress.preview_score,
      total_questions: userProgress.total_questions,
      correct_answers: userProgress.correct_answers,
      scoring_status: userProgress.scoring_status,
      full_result_unlocked: userProgress.full_result_unlocked,
      result_available_at: userProgress.result_available_at,
      completed_at: userProgress.completed_at,
    })
    .from(userProgress)
    .innerJoin(lessons, eq(lessons.id, userProgress.lesson_id))
    .where(and(...testConditions))
    .orderBy(desc(userProgress.completed_at))
    .limit(limit + offset) // Lấy dư để merge
    .all();

  // 2. Fetch from speakingSessions — left join lessons to get proper title
  // Speaking sessions don't have mini/full/practice type in DB, but we consider them 'mini' tests
  const speakingRows = (type && type !== 'mini') ? [] : await db
    .select({
      id: speakingSessions.id,
      user_id: speakingSessions.user_id,
      lesson_id: speakingSessions.lesson_id,
      topic: speakingSessions.topic,
      part: speakingSessions.part,
      status: speakingSessions.status,
      turn_count: speakingSessions.turn_count,
      average_band: speakingSessions.average_band,
      report_unlocked: speakingSessions.report_unlocked,
      report_available_at: speakingSessions.report_available_at,
      ended_at: speakingSessions.ended_at,
      // lesson title — null for free-practice sessions (no lesson_id)
      lesson_title: lessons.title,
    })
    .from(speakingSessions)
    .leftJoin(lessons, eq(lessons.id, speakingSessions.lesson_id))
    .where(and(
      eq(speakingSessions.user_id, userId),
      eq(speakingSessions.status, 'completed')
    ))
    .orderBy(desc(speakingSessions.ended_at))
    .limit(limit + offset)
    .all();

  // 3. Merge and normalize
  const combined = [
    ...testRows.map((r) => {
      const isWriting = r.lesson_type === 'writing';
      const scoringDone = r.scoring_status === 'completed' || r.scoring_status === 'none';
      const unlocked = isPremium || !!r.full_result_unlocked;
      const displayScore = scoringDone && (unlocked || !isWriting) ? (r.score ?? 0) : (r.preview_score ?? null);

      return {
        id: r.id,
        progress_id: r.id,
        kind: 'test',
        lesson_id: r.lesson_id,
        lesson_title: r.lesson_title,
        lesson_type: r.lesson_type,
        test_type: r.test_type,
        score: displayScore,
        total_questions: r.total_questions ?? 0,
        correct_answers: r.correct_answers ?? 0,
        accuracy_pct: r.total_questions && r.total_questions > 0
          ? Math.round(((r.correct_answers ?? 0) / r.total_questions) * 100)
          : 0,
        scoring_status: r.scoring_status ?? 'none',
        full_result_unlocked: unlocked,
        needs_unlock: !isPremium && isWriting && scoringDone && !r.full_result_unlocked,
        result_available_at: r.result_available_at ? new Date(r.result_available_at).getTime() / 1000 : null,
        completed_at: r.completed_at ? new Date(r.completed_at).getTime() / 1000 : null,
      };
    }),
    ...speakingRows.map((s) => {
      const unlocked = isPremium || !!s.report_unlocked;
      // For old sessions without lesson_id, topic may contain raw cue card text (multi-line).
      // Use lesson title if available; otherwise take only the first line of the topic.
      const rawTopic = s.topic || 'Speaking Practice';
      const firstLine = rawTopic.split('\n')[0].trim();
      const displayTitle = s.lesson_title ?? firstLine;
      return {
        id: s.id,
        progress_id: s.id,
        kind: 'speaking',
        lesson_id: s.lesson_id ?? null,
        lesson_title: displayTitle,
        lesson_type: 'speaking',
        test_type: 'mini',
        score: s.average_band,
        total_questions: s.turn_count ?? 0,
        correct_answers: 0,
        accuracy_pct: 0,
        scoring_status: 'completed',
        full_result_unlocked: unlocked,
        needs_unlock: !isPremium && !s.report_unlocked,
        result_available_at: s.report_available_at ? new Date(s.report_available_at).getTime() / 1000 : null,
        completed_at: s.ended_at ? new Date(s.ended_at).getTime() / 1000 : null,
      };
    })
  ];

  // Sort by completed_at desc
  combined.sort((a, b) => (b.completed_at || 0) - (a.completed_at || 0));

  // Slice for pagination
  const result = combined.slice(offset, offset + limit);

  return c.json({ success: true, data: result });
});

// GET /api/v1/progress/by-id/:progress_id — lấy kết quả theo progress_id cụ thể (dùng cho history detail)
progressRouter.get('/by-id/:progress_id', async (c) => {
  const progressId = c.req.param('progress_id');
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;
  const db = drizzle(c.env.DB);

  const progress = await db.select()
    .from(userProgress)
    .where(and(eq(userProgress.id, progressId), eq(userProgress.user_id, userId)))
    .get();

  if (!progress) {
    return c.json({ success: false, error: 'Progress not found' }, 404);
  }

  const service = new ProgressService(c.env.DB);
  const fullProgress = await service.getProgress(userId, progress.lesson_id);

  return c.json({ success: true, data: fullProgress ?? null });
});

// GET /api/v1/progress/:lesson_id
progressRouter.get('/:lesson_id', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;

  const service = new ProgressService(c.env.DB);
  const progress = await service.getProgress(userId, lessonId);

  return c.json({ success: true, data: progress ?? null });
});

// POST /api/v1/progress/save-draft
progressRouter.post('/save-draft', async (c) => {
  const body = await c.req.json();
  const { lesson_id, draft_answers, time_left } = body;

  if (!lesson_id) {
    return c.json({ success: false, error: { message: 'lesson_id is required' } }, 400);
  }

  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;

  const service = new ProgressService(c.env.DB);
  const progress = await service.saveDraft(userId, lesson_id, draft_answers, time_left);

  return c.json({ success: true, data: progress });
});

// POST /api/v1/progress/submit
progressRouter.post('/submit', aiRateLimit, async (c) => {
  const body = await c.req.json();
  const { lesson_id, answers } = body;

  if (!lesson_id || !answers) {
    return c.json({ success: false, error: { message: 'lesson_id and answers are required' } }, 400);
  }

  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;

  try {
    const service = new ProgressService(c.env.DB);
    // Truyền env để background scoring dùng Queue
    const result = await service.submitAndScore(userId, lesson_id, answers, c.env, c.executionCtx);

    return c.json({ success: true, data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Submit failed';
    return c.json({ success: false, error: { message } }, 500);
  }
});

// POST /api/v1/progress/:progress_id/unlock
// Demo: fake ads — tap là unlock ngay (thay bằng AdMob SSV khi có production)
progressRouter.post('/:progress_id/unlock', async (c) => {
  const progressId = c.req.param('progress_id');
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;
  const db = drizzle(c.env.DB);

  // Verify ownership
  const progress = await db.select()
    .from(userProgress)
    .where(and(eq(userProgress.id, progressId), eq(userProgress.user_id, userId)))
    .get();

  if (!progress) {
    return c.json({ success: false, error: 'Progress not found' }, 404);
  }
  if (progress.scoring_status !== 'completed') {
    return c.json({ success: false, error: 'Result not ready yet' }, 400);
  }
  if (progress.full_result_unlocked) {
    return c.json({ success: true, data: { already_unlocked: true } });
  }

  // Unlock — lấy full feedback từ submissions
  await db.update(userProgress)
    .set({ full_result_unlocked: true, updated_at: new Date() })
    .where(eq(userProgress.id, progressId))
    .run();

  // Lấy full result để trả về ngay
  const lessonQuestions = await db.select()
    .from(questions)
    .where(eq(questions.lesson_id, progress.lesson_id))
    .all();

  const questionIds = lessonQuestions.map(q => q.id);
  const userSubmissions = questionIds.length > 0
    ? await db.select().from(submissions)
        .where(and(eq(submissions.user_id, userId), eq(submissions.status, 'completed')))
        .all()
    : [];

  const results = userSubmissions
    .filter(s => questionIds.includes(s.question_id))
    .map(s => ({
      question_id: s.question_id,
      score: s.score,
      feedback: s.feedback ? (typeof s.feedback === 'string' ? JSON.parse(s.feedback) : s.feedback) : undefined,
    }));

  return c.json({ success: true, data: { unlocked: true, results } });
});

// GET /api/v1/progress/:progress_id/stream (SSE)
progressRouter.get('/:progress_id/stream', async (c) => {
  const progressId = c.req.param('progress_id');
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;
  
  return streamSSE(c, async (stream) => {
    let isComplete = false;
    let attempts = 0;
    const db = drizzle(c.env.DB);
    
    while (!isComplete && attempts < 300) { // 300 * 2s = 10 phút timeout
      try {
        const progress = await db.select()
          .from(userProgress)
          .where(and(eq(userProgress.id, progressId), eq(userProgress.user_id, userId)))
          .get();
          
        if (!progress) {
          await stream.writeSSE({ data: JSON.stringify({ error: 'Not found' }), event: 'error' });
          break;
        }
        
        if (progress.scoring_status === 'completed' || progress.scoring_status === 'failed') {
          const service = new ProgressService(c.env.DB);
          const fullProgress = await service.getProgress(userId, progress.lesson_id);
          
          await stream.writeSSE({ data: JSON.stringify(fullProgress), event: 'completed' });
          isComplete = true;
          break;
        }
        
        await stream.writeSSE({ data: JSON.stringify({ status: progress.scoring_status }), event: 'ping' });
      } catch (err) {
        console.error('SSE Error:', err);
        break;
      }
      
      await stream.sleep(2000);
      attempts++;
    }
  });
});

export default progressRouter;
