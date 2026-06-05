import { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { AIService } from './ai.service';
import { PassageService } from './passage.service';
import { QuestionGroupService } from './question-group.service';
import { QuestionService } from './question.service';
import { JobService } from './job.service';

export class AdminContentService {
  constructor(private d1: D1Database, private cache: KVNamespace) {}

  async generateLessonContent(lessonId: string, rawText: string, lessonType: string, ai: any, jobId: string) {
    const aiService = new AIService(ai);
    const passageService = new PassageService(this.d1);
    const groupService = new QuestionGroupService(this.d1);
    const questionService = new QuestionService(this.d1);
    const jobService = new JobService(this.cache);

    try {
      const parsed = await aiService.parseExamContent(rawText, lessonType);
      if (!parsed || !Array.isArray(parsed.sections)) throw new Error('Invalid AI Response Structure');

      for (const section of parsed.sections) {
        const passage = await passageService.create({
          lesson_id: lessonId,
          title: section?.passage?.title || 'Untitled Section',
          content_html: section?.passage?.content_html || '',
          part: section.part_number || 1,
          audio_url: section?.passage?.audio_url || null,
          image_url: section?.passage?.image_url || null
        });

        const groups = section.question_groups || section.groups;
        if (groups && Array.isArray(groups)) {
          for (const groupData of groups) {
            const group = await groupService.create({
              lesson_id: lessonId,
              passage_id: passage.id,
              title: groupData?.title || 'Question Group',
              instruction: groupData?.instruction || '',
              group_type: parsed.type === 'WRITING' ? 'WRITING_TASK' : (groupData?.group_type || 'READING'),
              part: section.part_number || 1,
              question_start: groupData?.question_number_start || null,
              question_end: groupData?.question_number_end || null
            });

            if (groupData.questions && Array.isArray(groupData.questions)) {
              for (const qData of groupData.questions) {
                await questionService.create({
                  lesson_id: lessonId,
                  group_id: group.id,
                  content: qData?.content || '',
                  options: qData?.options || {},
                  correct_answer: qData?.correct_answer || '',
                  question_type: parsed.type === 'WRITING' ? 'writing' : (parsed.type === 'SPEAKING' ? 'speaking' : (parsed.type === 'LISTENING' ? 'listening' : 'reading')),
                  question_format: groupData?.group_type || null,
                  scoring_criteria: qData?.scoring_criteria || null
                });
              }
            }
          }
        }
      }
      await jobService.update(jobId, { status: 'completed' });
    } catch (err: any) {
      console.error('BG GEN ERROR:', err);
      try {
         const { drizzle } = await import('drizzle-orm/d1');
         const { passages } = await import('../db/schema');
         const { eq } = await import('drizzle-orm');
         const db = drizzle(this.d1);
         await db.delete(passages).where(eq(passages.lesson_id, lessonId));
      } catch (e) {}
      await jobService.update(jobId, { status: 'failed', error: err.message });
    }
  }
}
