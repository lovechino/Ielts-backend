import { Hono } from 'hono';
import { LessonService } from '../../services/lesson.service';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { lessons, userProgress } from '../../db/schema';
import type { Bindings } from '../../index';
import { requireJwtSecret } from '../../middleware/auth';

const testRouter = new Hono<{ Bindings: Bindings }>();

// GET /api/v1/tests?type=mini|full
testRouter.get('/', async (c, next) => {
  const secret = requireJwtSecret(c);
  return jwt({ secret, alg: 'HS256' })(c, next);
}, async (c) => {
  const payload = c.get('jwtPayload') as { sub: string };
  const userId = payload.sub;
  const type = c.req.query('type');
  
  const db = drizzle(c.env.DB);
  const conditions = [eq(lessons.is_test, true)];
  if (type) conditions.push(eq(lessons.test_type, type as any));

  const rows = await db.select({
    id: lessons.id,
    course_id: lessons.course_id,
    title: lessons.title,
    order: lessons.order,
    lesson_type: lessons.lesson_type,
    pdf_url: lessons.pdf_url,
    is_test: lessons.is_test,
    test_type: lessons.test_type,
    time_limit: lessons.time_limit,
    lesson_parts: lessons.lesson_parts,
    user_progress: {
      status: userProgress.status,
      score: userProgress.score,
    }
  })
  .from(lessons)
  .leftJoin(userProgress, and(eq(userProgress.lesson_id, lessons.id), eq(userProgress.user_id, userId)))
  .where(and(...conditions))
  .all();
  
  return c.json({ success: true, data: rows });
});

export default testRouter;
