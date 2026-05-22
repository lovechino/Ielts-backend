import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users } from '../../../db/schema';
import { CourseService } from '../../../services/course.service';
import { LessonService } from '../../../services/lesson.service';
import { QuestionService } from '../../../services/question.service';
import { PassageService } from '../../../services/passage.service';
import { QuestionGroupService } from '../../../services/question-group.service';
import { AIService } from '../../../services/ai.service';
import { JobService } from '../../../services/job.service';
import type { Bindings } from '../../../index';

const adminCourseRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

adminCourseRouter.use('/*', async (c, next) => {
  if (c.env.ENABLE_ADMIN !== 'true') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  return next();
});

adminCourseRouter.use('/*', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  const jwtMiddleware = jwt({ secret, alg: 'HS256' });
  return jwtMiddleware(c, next);
});

adminCourseRouter.use('/*', async (c, next) => {
  const payload = c.get('jwtPayload') as { sub: string; role?: string };
  if (payload.role !== 'admin') {
    const db = drizzle(c.env.DB);
    const user = await db.select({ role: users.role }).from(users).where(eq(users.id, payload.sub)).get();
    if (user?.role !== 'admin') {
      return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
    }
  }
  return next();
});

adminCourseRouter.post('/', async (c) => {
  const body = await c.req.json();
  const service = new CourseService(c.env.DB);
  const course = await service.create(body);
  return c.json({ success: true, data: course });
});

adminCourseRouter.post('/:course_id/lessons', async (c) => {
  const courseId = c.req.param('course_id');
  const body = await c.req.json();
  const service = new LessonService(c.env.DB);

  if (Array.isArray(body)) {
    const lessonsWithCourseId = body.map(item => ({ ...item, course_id: courseId }));
    const result = await service.createMany(lessonsWithCourseId);
    return c.json({ success: true, data: result });
  } else {
    const incomingCourseId = body.courseId || body.course_id;
    if (incomingCourseId && incomingCourseId !== courseId) {
      return c.json({ success: false, error: { message: 'Course ID mismatch' } }, 400);
    }
    const lessonData = { ...body, course_id: courseId };
    const lesson = await service.create(lessonData);
    return c.json({ success: true, data: lesson });
  }
});

adminCourseRouter.put('/lessons/:lesson_id', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const body = await c.req.json();
  const service = new LessonService(c.env.DB);
  const lesson = await service.update(lessonId, body);
  if (!lesson) {
    return c.json({ success: false, error: { message: 'Lesson not found' } }, 404);
  }
  return c.json({ success: true, data: lesson });
});

adminCourseRouter.delete('/lessons/:lesson_id', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const service = new LessonService(c.env.DB);
  const deleted = await service.delete(lessonId);
  if (!deleted) {
    return c.json({ success: false, error: { message: 'Lesson not found' } }, 404);
  }
  return c.json({ success: true, data: { deleted: true } });
});

adminCourseRouter.post('/lessons/:lesson_id/passages', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const body = await c.req.json();
  const service = new PassageService(c.env.DB);
  const passage = await service.create({ ...body, lesson_id: lessonId });
  return c.json({ success: true, data: passage });
});

adminCourseRouter.post('/lessons/:lesson_id/question-groups', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const body = await c.req.json();
  const service = new QuestionGroupService(c.env.DB);
  const group = await service.create({ ...body, lesson_id: lessonId });
  return c.json({ success: true, data: group });
});

adminCourseRouter.post('/lessons/:lesson_id/questions', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const body = await c.req.json();
  const lesson_id_from_body = body.lesson_id || body.lessonId;
  if (lesson_id_from_body && lesson_id_from_body !== lessonId) {
    return c.json({ success: false, error: { message: 'Lesson ID mismatch' } }, 400);
  }
  const service = new QuestionService(c.env.DB);
  const question = await service.create(body);
  return c.json({ success: true, data: question });
});

adminCourseRouter.post('/lessons/:lesson_id/auto-generate', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const body = await c.req.json();
  const raw_text = body.rawText || body.raw_text;

  if (!raw_text) {
    return c.json({ success: false, error: { message: 'raw_text is required' } }, 400);
  }

  const jobId = `gen_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const jobService = new JobService(c.env.CACHE);
  await jobService.create(jobId);

  c.executionCtx.waitUntil((async () => {
    const aiService = new AIService(c.env.AI);
    const passageService = new PassageService(c.env.DB);
    const groupService = new QuestionGroupService(c.env.DB);
    const questionService = new QuestionService(c.env.DB);

    try {
      const parsed = await aiService.parseExamContent(raw_text);
      if (!parsed || !Array.isArray(parsed.sections)) throw new Error('Invalid AI Response Structure');

      for (const section of parsed.sections) {
        const passage = await passageService.create({
          lesson_id: lessonId,
          title: section?.passage?.title || 'Untitled Section',
          content_html: section?.passage?.content_html || ''
        });

        const groups = section.question_groups || section.groups;
        if (groups && Array.isArray(groups)) {
          for (const groupData of groups) {
            const group = await groupService.create({
              lesson_id: lessonId,
              passage_id: passage.id,
              title: groupData?.title || 'Question Group',
              instruction: groupData?.instruction || '',
              group_type: parsed.type === 'WRITING' ? 'WRITING_TASK' : (groupData?.group_type || 'READING')
            });

            if (groupData.questions && Array.isArray(groupData.questions)) {
              for (const qData of groupData.questions) {
                await questionService.create({
                  lesson_id: lessonId,
                  group_id: group.id,
                  content: qData?.content || '',
                  options: qData?.options || {},
                  correct_answer: qData?.correct_answer || '',
                  question_type: parsed.type === 'WRITING' ? 'writing' : 'reading'
                });
              }
            }
          }
        }
      }
      await jobService.update(jobId, { status: 'completed' });
    } catch (err: any) {
      console.error('BG GEN ERROR:', err);
      await jobService.update(jobId, { status: 'failed', error: err.message });
    }
  })());

  return c.json({ success: true, data: { job_id: jobId } }, 202);
});

export default adminCourseRouter;
