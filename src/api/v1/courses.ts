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

const courseRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

courseRouter.get('/', async (c) => {
  const service = new CourseService(c.env.DB, c.env.CACHE);
  const courses = await service.getAll();
  return c.json({ success: true, data: courses });
});

courseRouter.get('/:course_id', async (c) => {
  const courseId = c.req.param('course_id');
  const service = new CourseService(c.env.DB, c.env.CACHE);
  const course = await service.getById(courseId);
  if (!course) {
    return c.json({ success: false, error: { message: 'Course not found' } }, 404);
  }
  return c.json({ success: true, data: course });
});

courseRouter.get('/:course_id/lessons', async (c) => {
  const courseId = c.req.param('course_id');
  const service = new LessonService(c.env.DB);
  const lessons = await service.getByCourse(courseId);
  return c.json({ success: true, data: lessons });
});

courseRouter.get('/lessons/:lesson_id', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const service = new LessonService(c.env.DB);
  const lesson = await service.getById(lessonId);
  if (!lesson) {
    return c.json({ success: false, error: { message: 'Lesson not found' } }, 404);
  }
  return c.json({ success: true, data: lesson });
});

courseRouter.get('/lessons/:lesson_id/passages', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const service = new PassageService(c.env.DB);
  const passages = await service.getByLesson(lessonId);
  return c.json({ success: true, data: passages });
});

courseRouter.get('/lessons/:lesson_id/question-groups', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const service = new QuestionGroupService(c.env.DB);
  const groups = await service.getByLesson(lessonId);
  return c.json({ success: true, data: groups });
});

courseRouter.get('/lessons/:lesson_id/questions', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const service = new QuestionService(c.env.DB);
  const questions = await service.getByLesson(lessonId);
  return c.json({ success: true, data: questions });
});

courseRouter.post('/:course_id/enroll', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  const jwtMiddleware = jwt({ secret, alg: 'HS256' });
  return jwtMiddleware(c, next);
}, async (c) => {
  const payload = c.get('jwtPayload') as any;
  const userId = payload.sub;
  const courseId = c.req.param('course_id');
  const db = drizzle(c.env.DB);

  try {
    const existing = await db.select().from(courseEnrollments)
      .where(and(eq(courseEnrollments.user_id, userId), eq(courseEnrollments.course_id, courseId)))
      .get();

    if (existing) {
      return c.json({ success: true, data: existing, message: 'Already enrolled' });
    }

    const newEnrollment = await db.insert(courseEnrollments)
      .values({ user_id: userId, course_id: courseId })
      .returning()
      .get();

    return c.json({ success: true, data: newEnrollment });
  } catch (error: any) {
    return c.json({ success: false, error: { message: error.message } }, 500);
  }
});

courseRouter.get('/:course_id/enroll-status', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  const jwtMiddleware = jwt({ secret, alg: 'HS256' });
  return jwtMiddleware(c, next);
}, async (c) => {
  const payload = c.get('jwtPayload') as any;
  const userId = payload.sub;
  const courseId = c.req.param('course_id');
  const db = drizzle(c.env.DB);

  try {
    const existing = await db.select().from(courseEnrollments)
      .where(and(eq(courseEnrollments.user_id, userId), eq(courseEnrollments.course_id, courseId)))
      .get();

    return c.json({ success: true, data: { enrolled: !!existing, status: existing?.status } });
  } catch (error: any) {
    return c.json({ success: false, error: { message: error.message } }, 500);
  }
});

export default courseRouter;
