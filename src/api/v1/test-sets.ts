import { Hono } from 'hono';
import { CourseService } from '../../services/course.service';
import { LessonService } from '../../services/lesson.service';
import { QuestionService } from '../../services/question.service';
import { PassageService } from '../../services/passage.service';
import { QuestionGroupService } from '../../services/question-group.service';
import type { Bindings } from '../../index';
import { jwt } from 'hono/jwt';
import { and, eq } from 'drizzle-orm';
import { courseEnrollments } from '../../db/schema';
import { drizzle } from 'drizzle-orm/d1';
import { requireJwtSecret } from '../../middleware/auth';

const testSetRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

testSetRouter.get('/', async (c) => {
  const service = new CourseService(c.env.DB, c.env.CACHE);
  const courses = await service.getAll();
  return c.json({ success: true, data: courses });
});

testSetRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const service = new CourseService(c.env.DB, c.env.CACHE);
  const course = await service.getById(id);
  if (!course) {
    return c.json({ success: false, error: { message: 'Test set not found' } }, 404);
  }
  return c.json({ success: true, data: course });
});

testSetRouter.get('/:id/lessons', async (c) => {
  const id = c.req.param('id');
  const service = new LessonService(c.env.DB);
  const lessons = await service.getByCourse(id);
  return c.json({ success: true, data: lessons });
});

testSetRouter.get('/lessons/:lesson_id', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const service = new LessonService(c.env.DB);
  const lesson = await service.getById(lessonId);
  if (!lesson) {
    return c.json({ success: false, error: { message: 'Test not found' } }, 404);
  }
  return c.json({ success: true, data: lesson });
});

testSetRouter.get('/lessons/:lesson_id/passages', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const service = new PassageService(c.env.DB);
  const passages = await service.getByLesson(lessonId);
  return c.json({ success: true, data: passages });
});

testSetRouter.get('/lessons/:lesson_id/question-groups', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const service = new QuestionGroupService(c.env.DB);
  const groups = await service.getByLesson(lessonId);
  return c.json({ success: true, data: groups });
});

testSetRouter.get('/lessons/:lesson_id/questions', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const service = new QuestionService(c.env.DB);
  const questions = await service.getByLesson(lessonId);
  return c.json({ success: true, data: questions });
});

testSetRouter.post('/:id/enroll', async (c, next) => {
  const secret = requireJwtSecret(c);
  const jwtMiddleware = jwt({ secret, alg: 'HS256' });
  return jwtMiddleware(c, next);
}, async (c) => {
  const payload = c.get('jwtPayload') as any;
  const userId = payload.sub;
  const id = c.req.param('id');
  const db = drizzle(c.env.DB);

  try {
    const existing = await db.select().from(courseEnrollments)
      .where(and(eq(courseEnrollments.user_id, userId), eq(courseEnrollments.course_id, id)))
      .get();

    if (existing) {
      return c.json({ success: true, data: existing, message: 'Already enrolled' });
    }

    const newEnrollment = await db.insert(courseEnrollments)
      .values({ user_id: userId, course_id: id })
      .returning()
      .get();

    return c.json({ success: true, data: newEnrollment });
  } catch (error: any) {
    return c.json({ success: false, error: { message: error.message } }, 500);
  }
});

testSetRouter.get('/:id/enroll-status', async (c, next) => {
  const secret = requireJwtSecret(c);
  const jwtMiddleware = jwt({ secret, alg: 'HS256' });
  return jwtMiddleware(c, next);
}, async (c) => {
  const payload = c.get('jwtPayload') as any;
  const userId = payload.sub;
  const id = c.req.param('id');
  const db = drizzle(c.env.DB);

  try {
    const existing = await db.select().from(courseEnrollments)
      .where(and(eq(courseEnrollments.user_id, userId), eq(courseEnrollments.course_id, id)))
      .get();

    return c.json({ success: true, data: { enrolled: !!existing, status: existing?.status } });
  } catch (error: any) {
    return c.json({ success: false, error: { message: error.message } }, 500);
  }
});

export default testSetRouter;
