import { Hono } from 'hono';
import { LessonService } from '../../services/lesson.service';
import type { Bindings } from '../../index';

const testRouter = new Hono<{ Bindings: Bindings }>();

// GET /api/v1/tests?type=mini|full
testRouter.get('/', async (c) => {
  const type = c.req.query('type');
  const service = new LessonService(c.env.DB);
  const tests = await service.getTests(type);
  
  return c.json({ success: true, data: tests });
});

export default testRouter;
