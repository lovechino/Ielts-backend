import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, inArray } from 'drizzle-orm';
import { vocabulary, questions as questionsTable } from '../../db/schema';
import type { Bindings } from '../../index';
import { AIService } from '../../services/ai.service';

const aiRouter = new Hono<{ Bindings: Bindings }>();

// Auth middleware
aiRouter.use('/*', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  return jwt({ secret, alg: 'HS256' })(c, next);
});

/**
 * POST /api/v1/ai/pronunciation-check
 * Body: { audio: base64, target_text: string }
 */
aiRouter.post('/pronunciation-check', async (c) => {
  const { audio, target_text } = await c.req.json();

  if (!audio || !target_text) {
    return c.json({ success: false, message: 'Missing audio or target_text' }, 422);
  }

  const db = drizzle(c.env.DB);

  try {
    // 1. Chuyển base64 sang Uint8Array
    const binaryString = atob(audio);
    const audioBuffer = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      audioBuffer[i] = binaryString.charCodeAt(i);
    }

    // 2. Sử dụng Cloudflare Workers AI Whisper để lấy Transcription (Latin)
    const response = await c.env.AI.run('@cf/openai/whisper', {
      audio: [...audioBuffer]
    });

    const transcription = response.text?.trim()?.toLowerCase() || '';
    const cleanTarget = target_text.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
    const cleanHeard = transcription.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");

    // 3. Chuyển đổi sang IPA để chấm điểm chính xác hơn
    // Lấy IPA chuẩn của từ mục tiêu
    const targetVocab = await db.select({ pronunciation: vocabulary.pronunciation })
      .from(vocabulary)
      .where(eq(vocabulary.word, cleanTarget))
      .get();
    
    // Lấy IPA của từ mà AI nghe được
    const heardVocab = await db.select({ pronunciation: vocabulary.pronunciation })
      .from(vocabulary)
      .where(eq(vocabulary.word, cleanHeard))
      .get();

    // Nếu không tìm thấy IPA trong DB, fallback về text thô (nhưng bọc trong //)
    const targetIpa = targetVocab?.pronunciation || `/${cleanTarget}/`;
    const heardIpa = heardVocab?.pronunciation || `/${cleanHeard}/`;

    // 4. Tính toán độ chính xác dựa trên chuỗi IPA
    // Loại bỏ các ký tự dấu / và dấu trọng âm để so sánh âm thuần túy (tùy chọn)
    const stripIpa = (s: string) => s.replace(/[\/\u02c8\u02cc]/g, ''); 
    const accuracy = calculateAccuracy(stripIpa(targetIpa), stripIpa(heardIpa));

    return c.json({
      success: true,
      data: {
        transcription: cleanHeard,
        target_text: cleanTarget,
        target_ipa: targetIpa,
        heard_ipa: heardIpa,
        accuracy,
        status: accuracy >= 0.8 ? 'excellent' : accuracy >= 0.5 ? 'good' : 'try_again'
      }
    });
  } catch (error: any) {
    console.error('AI Pronunciation Error:', error);
    return c.json({ success: false, message: 'AI processing failed', error: error.message }, 500);
  }
});

/**
 * POST /api/v1/ai/explain
 * Body: { question_id, passage?, question?, options?, correct_answer? }
 */
aiRouter.post('/explain', async (c) => {
  const { question_id, passage, question, options, correct_answer } = await c.req.json();

  if (!question_id && (!passage || !question || !correct_answer)) {
    return c.json({ success: false, message: 'Missing required fields' }, 422);
  }

  const db = drizzle(c.env.DB);
  const aiService = new AIService(c.env.AI, c.env.CACHE);

  try {
    let finalPassage = passage;
    let finalQuestion = question;
    let finalOptions = options || [];
    let finalCorrectAnswer = correct_answer;

    // Nếu có question_id, ưu tiên lấy từ DB để đảm bảo data chuẩn
    if (question_id) {
      const q = await db.select().from(questionsTable).where(eq(questionsTable.id, question_id)).get();
      if (q) {
        finalQuestion = q.content;
        finalCorrectAnswer = q.correct_answer;
        finalOptions = q.options ? (typeof q.options === 'string' ? JSON.parse(q.options) : q.options) : [];
        
        // Fetch passage via group
        const { questionGroups, passages } = await import('../../db/schema');
        if (q.group_id) {
          const group = await db.select().from(questionGroups).where(eq(questionGroups.id, q.group_id)).get();
          if (group?.passage_id) {
            const p = await db.select().from(passages).where(eq(passages.id, group.passage_id)).get();
            if (p) finalPassage = p.content_html;
          }
        }
      }
    }

    const result = await aiService.generateExplanation(
      finalPassage || '',
      finalQuestion || '',
      Array.isArray(finalOptions) ? finalOptions : [],
      finalCorrectAnswer || '',
      question_id
    );

    return c.json({ success: true, data: result });
  } catch (error: any) {
    console.error('AI Explain Error:', error);
    return c.json({ success: false, message: 'AI processing failed' }, 500);
  }
});

/**
 * POST /api/v1/ai/explain/batch
 * Body: { questions: [{ question_id, passage?, question?, options?, correct_answer? }] }
 */
aiRouter.post('/explain/batch', async (c) => {
  const { questions: items } = await c.req.json();

  if (!Array.isArray(items)) {
    return c.json({ success: false, message: 'Invalid questions array' }, 422);
  }

  const db = drizzle(c.env.DB);
  const aiService = new AIService(c.env.AI, c.env.CACHE);
  
  // 1. Lấy toàn bộ data từ DB trước nếu cần
  const questionIds = items.map(i => i.question_id).filter(id => !!id);
  let dbQuestions: any[] = [];
  if (questionIds.length > 0) {
    const { questions: qTable } = await import('../../db/schema');
    const { inArray } = await import('drizzle-orm');
    dbQuestions = await db.select().from(qTable).where(inArray(qTable.id, questionIds)).all();
  }

  // 2. Xử lý từng câu (có cache lo liệu bên trong AIService)
  const results = await Promise.all(items.map(async (item) => {
    let finalPassage = item.passage;
    let finalQuestion = item.question;
    let finalOptions = item.options || [];
    let finalCorrectAnswer = item.correct_answer;

    if (item.question_id) {
      const q = dbQuestions.find(dq => dq.id === item.question_id);
      if (q) {
        finalQuestion = q.content;
        finalCorrectAnswer = q.correct_answer;
        finalOptions = q.options ? (typeof q.options === 'string' ? JSON.parse(q.options) : q.options) : [];
        
        // Fetch passage if missing
        if (!finalPassage && q.group_id) {
          const { questionGroups, passages } = await import('../../db/schema');
          const group = await db.select().from(questionGroups).where(eq(questionGroups.id, q.group_id)).get();
          if (group?.passage_id) {
            const p = await db.select().from(passages).where(eq(passages.id, group.passage_id)).get();
            if (p) finalPassage = p.content_html;
          }
        }
      }
    }

    try {
      return {
        question_id: item.question_id,
        ...(await aiService.generateExplanation(
          finalPassage || '',
          finalQuestion || '',
          Array.isArray(finalOptions) ? finalOptions : [],
          finalCorrectAnswer || '',
          item.question_id
        ))
      };
    } catch (e) {
      return { question_id: item.question_id, error: 'Failed to generate' };
    }
  }));

  return c.json({ success: true, data: results });
});

// Thuật toán so sánh đơn giản (Có thể nâng cấp lên phoneme level sau)
function calculateAccuracy(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const len1 = s1.length;
  const len2 = s2.length;
  const matrix = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[len1][len2];
  return Math.max(0, 1 - distance / Math.max(len1, len2));
}

export default aiRouter;
