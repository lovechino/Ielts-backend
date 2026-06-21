import { Hono } from 'hono';
import { CourseService } from '../../../services/course.service';
import { LessonService } from '../../../services/lesson.service';
import { QuestionService } from '../../../services/question.service';
import { PassageService } from '../../../services/passage.service';
import { QuestionGroupService } from '../../../services/question-group.service';
import { AIService } from '../../../services/ai.service';
import { JobService } from '../../../services/job.service';
import { AdminContentService } from '../../../services/admin-content.service';
import type { Bindings, Variables } from '../../../index';
import { adminGuard } from '../../../middleware/auth';
import { writeAdminAuditLog } from '../../../services/admin-audit.service';

const adminCourseRouter = new Hono<{ Bindings: Bindings, Variables: Variables }>({ strict: false });

adminCourseRouter.use('/*', adminGuard);

adminCourseRouter.post('/', async (c) => {
  const body = await c.req.json();
  const service = new CourseService(c.env.DB);
  const course = await service.create(body);
  await writeAdminAuditLog(c, 'test_set.create', {
    targetType: 'course',
    targetId: course?.id,
    metadata: { title: body.title },
  });
  return c.json({ success: true, data: course });
});

// New: Create lesson without mandatory course_id (Independent Test)
adminCourseRouter.post('/lessons', async (c) => {
  const body = await c.req.json();
  const service = new LessonService(c.env.DB);
  const lesson = await service.create(body);
  await writeAdminAuditLog(c, 'lesson.create', {
    targetType: 'lesson',
    targetId: lesson?.id,
    metadata: { title: body.title, course_id: body.course_id },
  });
  return c.json({ success: true, data: lesson });
});

// New: Quick Import - Create Course (optional), Lesson, and trigger AI in one step
adminCourseRouter.post('/quick-import', async (c) => {
  const body = await c.req.json() as {
    title: string;
    lesson_type: string;
    test_type: string;
    raw_text: string;
    test_set_title?: string;
    course_id?: string;
  };

  const courseService = new CourseService(c.env.DB, c.env.CACHE);
  const lessonService = new LessonService(c.env.DB);
  const adminContentService = new AdminContentService(c.env.DB, c.env.CACHE);
  const jobService = new JobService(c.env.CACHE);

  let targetCourseId = body.course_id;

  // Auto-grouping logic
  if (!targetCourseId && body.test_set_title) {
    const existing = await courseService.getByTitle(body.test_set_title);
    if (existing) {
      targetCourseId = existing.id;
    } else {
      const newCourse = await courseService.create({
        title: body.test_set_title,
        slug: body.test_set_title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Math.random().toString(36).substring(7),
        description: `Imported from quick-import: ${body.title}`,
      });
      targetCourseId = newCourse.id;
    }
  }

  // Create the Lesson
  const lesson = await lessonService.create({
    title: body.title,
    lesson_type: body.lesson_type,
    test_type: body.test_type,
    course_id: targetCourseId || null,
    is_test: true,
  });

  // Trigger AI Background process
  const jobId = `qimp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  await jobService.create(jobId);

  c.executionCtx.waitUntil(
    adminContentService.generateLessonContent(lesson.id, body.raw_text, body.lesson_type, c.env.AI, jobId)
  );

  await writeAdminAuditLog(c, 'lesson.quick_import', {
    targetType: 'lesson',
    targetId: lesson.id,
    metadata: { title: body.title, course_id: targetCourseId, job_id: jobId },
  });

  return c.json({
    success: true,
    data: {
      lesson,
      job_id: jobId
    }
  }, 202);
});

// New: Preview AI Dry-run
adminCourseRouter.post('/quick-import/preview', async (c) => {
  const body = await c.req.json() as { raw_text: string, lesson_type: string };
  const aiService = new AIService(c.env.AI, c.env.CACHE);
  try {
    const parsed = await aiService.parseExamContent(body.raw_text, body.lesson_type);
    
    // Create a simplified summary for the preview UI
    let totalQuestions = 0;
    const sections = parsed.sections?.map((s: any) => {
      const groups = s.question_groups || s.groups || [];
      const mappedGroups = groups.map((g: any) => {
        const qCount = Array.isArray(g.questions) ? g.questions.length : 0;
        totalQuestions += qCount;
        return {
          type: g.group_type,
          range: g.question_number_start && g.question_number_end ? `${g.question_number_start}-${g.question_number_end}` : `${qCount} questions`,
          count: qCount
        };
      });
      return {
        part_number: s.part_number || 1,
        passage_title: s.passage?.title || 'Untitled',
        groups: mappedGroups
      };
    }) || [];

    return c.json({
      success: true,
      data: {
        type: parsed.type,
        total_parts: sections.length,
        total_questions: totalQuestions,
        sections
      }
    });
  } catch (err: any) {
    return c.json({ success: false, error: { message: err.message } }, 500);
  }
});

adminCourseRouter.post('/:course_id/lessons', async (c) => {
  const courseId = c.req.param('course_id');
  const body = await c.req.json();
  const service = new LessonService(c.env.DB);

  if (Array.isArray(body)) {
    const lessonsWithCourseId = body.map(item => ({ ...item, course_id: courseId }));
    const result = await service.createMany(lessonsWithCourseId);
    await writeAdminAuditLog(c, 'lesson.bulk_create', {
      targetType: 'course',
      targetId: courseId,
      metadata: { count: body.length },
    });
    return c.json({ success: true, data: result });
  } else {
    const incomingCourseId = body.courseId || body.course_id;
    if (incomingCourseId && incomingCourseId !== courseId) {
      return c.json({ success: false, error: { message: 'Course ID mismatch' } }, 400);
    }
    const lessonData = { ...body, course_id: courseId };
    const lesson = await service.create(lessonData);
    await writeAdminAuditLog(c, 'lesson.create', {
      targetType: 'lesson',
      targetId: lesson?.id,
      metadata: { title: body.title, course_id: courseId },
    });
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
  await writeAdminAuditLog(c, 'lesson.update', {
    targetType: 'lesson',
    targetId: lessonId,
    metadata: { fields: Object.keys(body) },
  });
  return c.json({ success: true, data: lesson });
});

adminCourseRouter.delete('/lessons/:lesson_id', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const service = new LessonService(c.env.DB);
  const deleted = await service.delete(lessonId);
  if (!deleted) {
    return c.json({ success: false, error: { message: 'Lesson not found' } }, 404);
  }
  await writeAdminAuditLog(c, 'lesson.delete', {
    targetType: 'lesson',
    targetId: lessonId,
  });
  return c.json({ success: true, data: { deleted: true } });
});

adminCourseRouter.post('/lessons/:lesson_id/passages', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const body = await c.req.json();
  const service = new PassageService(c.env.DB);
  const passage = await service.create({ ...body, lesson_id: lessonId });
  await writeAdminAuditLog(c, 'passage.create', {
    targetType: 'passage',
    targetId: passage?.id,
    metadata: { lesson_id: lessonId, title: body.title },
  });
  return c.json({ success: true, data: passage });
});

adminCourseRouter.put('/passages/:passage_id', async (c) => {
  const passageId = c.req.param('passage_id');
  const body = await c.req.json();
  const service = new PassageService(c.env.DB);
  const passage = await service.update(passageId, body);
  if (!passage) return c.json({ success: false, error: { message: 'Passage not found' } }, 404);
  await writeAdminAuditLog(c, 'passage.update', {
    targetType: 'passage',
    targetId: passageId,
    metadata: { fields: Object.keys(body) },
  });
  return c.json({ success: true, data: passage });
});

adminCourseRouter.delete('/passages/:passage_id', async (c) => {
  const passageId = c.req.param('passage_id');
  const service = new PassageService(c.env.DB);
  await service.delete(passageId);
  await writeAdminAuditLog(c, 'passage.delete', {
    targetType: 'passage',
    targetId: passageId,
  });
  return c.json({ success: true, data: { deleted: true } });
});

adminCourseRouter.post('/lessons/:lesson_id/question-groups', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const body = await c.req.json();
  const service = new QuestionGroupService(c.env.DB);
  const group = await service.create({ ...body, lesson_id: lessonId });
  await writeAdminAuditLog(c, 'question_group.create', {
    targetType: 'question_group',
    targetId: group?.id,
    metadata: { lesson_id: lessonId, group_type: body.group_type },
  });
  return c.json({ success: true, data: group });
});

adminCourseRouter.put('/question-groups/:group_id', async (c) => {
  const groupId = c.req.param('group_id');
  const body = await c.req.json();
  const service = new QuestionGroupService(c.env.DB);
  const group = await service.update(groupId, body);
  if (!group) return c.json({ success: false, error: { message: 'Question group not found' } }, 404);
  await writeAdminAuditLog(c, 'question_group.update', {
    targetType: 'question_group',
    targetId: groupId,
    metadata: { fields: Object.keys(body) },
  });
  return c.json({ success: true, data: group });
});

adminCourseRouter.delete('/question-groups/:group_id', async (c) => {
  const groupId = c.req.param('group_id');
  const service = new QuestionGroupService(c.env.DB);
  await service.delete(groupId);
  await writeAdminAuditLog(c, 'question_group.delete', {
    targetType: 'question_group',
    targetId: groupId,
  });
  return c.json({ success: true, data: { deleted: true } });
});

adminCourseRouter.post('/lessons/:lesson_id/questions', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const body = await c.req.json();
  const service = new QuestionService(c.env.DB);
  // Always inject lesson_id from URL — body may omit it
  const question = await service.create({ ...body, lesson_id: lessonId });
  await writeAdminAuditLog(c, 'question.create', {
    targetType: 'question',
    targetId: question?.id,
    metadata: { lesson_id: lessonId, question_type: body.question_type },
  });
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

  const adminContentService = new AdminContentService(c.env.DB, c.env.CACHE);

  const lessonService = new LessonService(c.env.DB);
  const lesson = await lessonService.getById(lessonId);
  const lessonType = lesson?.lesson_type || 'reading';

  c.executionCtx.waitUntil(
    adminContentService.generateLessonContent(lessonId, raw_text, lessonType, c.env.AI, jobId)
  );

  await writeAdminAuditLog(c, 'lesson.auto_generate', {
    targetType: 'lesson',
    targetId: lessonId,
    metadata: { job_id: jobId, lesson_type: lessonType },
  });

  return c.json({ success: true, data: { job_id: jobId } }, 202);
});

export default adminCourseRouter;
