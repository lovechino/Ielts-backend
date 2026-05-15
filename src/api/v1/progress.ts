import { Hono } from 'hono';
import { ProgressService } from '../../services/progress.service';
import { Bindings } from '../../index';

const progressRouter = new Hono<{ Bindings: Bindings }>();

// GET /api/v1/progress/:lesson_id?user_id=...
progressRouter.get('/:lesson_id', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const userId = c.req.query('user_id') || 'test-user-id';
  
  const service = new ProgressService(c.env.DB);
  const progress = await service.getProgress(userId, lessonId);
  
  return c.json({ success: true, data: progress });
});

// POST /api/v1/progress/save-draft
progressRouter.post('/save-draft', async (c) => {
  const body = await c.req.json();
  const { lesson_id, draft_answers, time_left } = body;
  const userId = body.user_id || 'test-user-id';

  if (!lesson_id) {
    return c.json({ success: false, error: { message: 'lesson_id is required' } }, 400);
  }

  const service = new ProgressService(c.env.DB);
  const progress = await service.saveDraft(userId, lesson_id, draft_answers, time_left);

  return c.json({ success: true, data: progress });
});

// POST /api/v1/progress/submit
progressRouter.post('/submit', async (c) => {
  const body = await c.req.json();
  const { lesson_id, answers } = body; // answers: [{question_id, answer}]
  const userId = body.user_id || 'test-user-id';

  if (!lesson_id || !answers) {
    return c.json({ success: false, error: { message: 'lesson_id and answers are required' } }, 400);
  }

  const service = new ProgressService(c.env.DB);
  const result = await service.submitAndScore(userId, lesson_id, answers, c.env.AI);

  return c.json({ 
    success: true, 
    data: result
  });
});

export default progressRouter;
