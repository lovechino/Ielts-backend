import { Hono } from 'hono';
import { CourseService } from '../../services/course.service';
import { LessonService } from '../../services/lesson.service';
import { QuestionService } from '../../services/question.service';
import { PassageService } from '../../services/passage.service';
import { QuestionGroupService } from '../../services/question-group.service';
import { AIService } from '../../services/ai.service';
import { JobService } from '../../services/job.service';
import type { Bindings } from '../../index';

const courseRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

// GET /api/v1/courses/
courseRouter.get('/', async (c) => {
  const service = new CourseService(c.env.DB, c.env.CACHE);
  const courses = await service.getAll();
  return c.json({ success: true, data: courses });
});

// POST /api/v1/courses/
courseRouter.post('/', async (c) => {
  const body = await c.req.json();
  const service = new CourseService(c.env.DB);
  const course = await service.create(body);
  return c.json({ success: true, data: course });
});

// GET /api/v1/courses/:course_id
courseRouter.get('/:course_id', async (c) => {
  const courseId = c.req.param('course_id');
  const service = new CourseService(c.env.DB, c.env.CACHE);
  const course = await service.getById(courseId);
  
  if (!course) {
    return c.json({ success: false, error: { message: 'Course not found' } }, 404);
  }
  return c.json({ success: true, data: course });
});


// GET /api/v1/courses/lessons/:lesson_id
courseRouter.get('/lessons/:lesson_id', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const service = new LessonService(c.env.DB);
  const lesson = await service.getById(lessonId);
  if (!lesson) {
    return c.json({ success: false, error: { message: 'Lesson not found' } }, 404);
  }
  return c.json({ success: true, data: lesson });
});

// PASSAGES
courseRouter.post('/lessons/:lesson_id/passages', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const body = await c.req.json();
  const service = new PassageService(c.env.DB);
  const passage = await service.create({ ...body, lesson_id: lessonId });
  return c.json({ success: true, data: passage });
});

courseRouter.get('/lessons/:lesson_id/passages', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const service = new PassageService(c.env.DB);
  const passages = await service.getByLesson(lessonId);
  return c.json({ success: true, data: passages });
});

// QUESTION GROUPS
courseRouter.post('/lessons/:lesson_id/question-groups', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const body = await c.req.json();
  const service = new QuestionGroupService(c.env.DB);
  const group = await service.create({ ...body, lesson_id: lessonId });
  return c.json({ success: true, data: group });
});

courseRouter.get('/lessons/:lesson_id/question-groups', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const service = new QuestionGroupService(c.env.DB);
  const groups = await service.getByLesson(lessonId);
  return c.json({ success: true, data: groups });
});




// PUT /api/v1/courses/lessons/:lesson_id
courseRouter.put('/lessons/:lesson_id', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const body = await c.req.json();
  const service = new LessonService(c.env.DB);
  const lesson = await service.update(lessonId, body);
  if (!lesson) {
    return c.json({ success: false, error: { message: 'Lesson not found' } }, 404);
  }
  return c.json({ success: true, data: lesson });
});

// GET /api/v1/courses/:course_id/lessons
courseRouter.get('/:course_id/lessons', async (c) => {
  const courseId = c.req.param('course_id');
  const service = new LessonService(c.env.DB);
  const lessons = await service.getByCourse(courseId);
  return c.json({ success: true, data: lessons });
});

// POST /api/v1/courses/:course_id/lessons
courseRouter.post('/:course_id/lessons', async (c) => {
  const courseId = c.req.param('course_id');
  const body = await c.req.json();
  const service = new LessonService(c.env.DB);

  if (Array.isArray(body)) {
    // Optional: Validate all items belong to this courseId
    const lessonsWithCourseId = body.map(item => ({
      ...item,
      course_id: courseId // Force the courseId from the URL
    }));
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

// GET /api/v1/courses/lessons/:lesson_id/questions
courseRouter.get('/lessons/:lesson_id/questions', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const service = new QuestionService(c.env.DB);
  const questions = await service.getByLesson(lessonId);
  return c.json({ success: true, data: questions });
});

// POST /api/v1/courses/lessons/:lesson_id/questions
courseRouter.post('/lessons/:lesson_id/questions', async (c) => {
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

// POST /api/v1/courses/lessons/:lesson_id/auto-generate
courseRouter.post('/lessons/:lesson_id/auto-generate', async (c) => {
  const lessonId = c.req.param('lesson_id');
  const body = await c.req.json();
  const raw_text = body.rawText || body.raw_text;

  if (!raw_text) {
    return c.json({ success: false, error: { message: 'raw_text is required' } }, 400);
  }

  const jobId = `gen_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const jobService = new JobService(c.env.CACHE);
  await jobService.create(jobId);

  // Background process
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

export default courseRouter;
