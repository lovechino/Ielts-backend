import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { ProgressService } from '../../services/progress.service';
import { Bindings } from '../../index';

const progressRouter = new Hono<{ Bindings: Bindings }>();

progressRouter.use('/*', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  return jwt({ secret, alg: 'HS256' })(c, next);
});

// GET /api/v1/progress/:lesson_id — user từ JWT (sub); không nhận user_id từ client
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
progressRouter.post('/submit', async (c) => {
  const body = await c.req.json();
  const { lesson_id, answers } = body;

  if (!lesson_id || !answers) {
    return c.json({ success: false, error: { message: 'lesson_id and answers are required' } }, 400);
  }

  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;

  try {
    const service = new ProgressService(c.env.DB);
    const result = await service.submitAndScore(userId, lesson_id, answers, c.env.AI);

    return c.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Submit failed';
    return c.json({ success: false, error: { message } }, 500);
  }
});

export default progressRouter;
