import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, and } from 'drizzle-orm';
import type { Bindings } from '../../index';
import { speakingSessions, speakingTurns, users, lessons } from '../../db/schema';
import { aiRateLimit } from '../../middleware/rateLimit';
import { sendPushNotification } from '../../services/push.service';
import { processSpeakingReport } from '../../workers/speaking-consumer';

const SPEAKING_REPORT_DELAY_MS = 5 * 60 * 1000; // 5 phút cho free user

const speakingRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

export const PERSONAS = {
  james: {
    id: 'james', name: 'James', accent: 'en-GB',
    systemPrompt: `You are James, a Senior British IELTS Examiner. Your tone is formal, extremely professional, and slightly intimidating. You value logical structure, precise vocabulary, and grammatical perfection. You never give undeserved praise and will pinpoint even minor slips in coherence.`
  },
  emily: {
    id: 'emily', name: 'Emily', accent: 'en-AU',
    systemPrompt: `You are Emily, a warm yet rigorous Australian IELTS Coach. Your style is encouraging but you follow the grading rubric strictly. You provide "sandwich feedback" (positive-critique-positive) but your Band scores reflect the hard truth of the official standards.`
  },
  dr_chen: {
    id: 'dr_chen', name: 'Dr. Chen', accent: 'en-US',
    systemPrompt: `You are Dr. Chen, a Linguistics Professor and IELTS Expert. You focus heavily on abstract thinking and lexical complexity. You will push the candidate to use more sophisticated academic collocations and complex sentence transformations (e.g., nominalization, inversion).`
  },
  sarah: {
    id: 'sarah', name: 'Sarah', accent: 'en-US',
    systemPrompt: `You are Sarah, a high-intensity American IELTS Trainer. You simulate high-pressure exam environments. You speak clearly but expect fast, well-developed responses. You are particularly strict about "Fluency & Coherence" and will penalize heavily for hesitation markers like "uhm" and "ah".`
  }
};

const IELTS_BAND_DESCRIPTORS = `
IELTS SPEAKING OFFICIAL CRITERIA (DETAILED):
1. FLUENCY & COHERENCE (FC):
   - 9.0: Full fluency, rare repetition/self-correction. Cohesion fully developed.
   - 8.0: Speaks fluently with only occasional repetition. Coherence is maintained.
   - 7.0: Speaks at length without effort. Uses a range of connectives/discourse markers.
   - 6.0: Willing to speak at length but may lose coherence due to repetition or self-correction.
   - 5.0: Slow speech with frequent repetition. Overuses basic linking words ("and", "but").
   - 4.0: Long pauses, limited linking words, cannot respond without effort.
   - 3.0: Speaks with long pauses. Has limited ability to link simple sentences. Gives only basic responses.
   - 2.0: Pauses are very long. Almost no ability to link sentences. Communication is extremely difficult.
2. LEXICAL RESOURCE (LR):
   - 9.0: Full flexibility and precision. Uses idiomatic language naturally.
   - 8.0: Wide vocabulary, uses less common and idiomatic items with minor inaccuracies.
   - 7.0: Uses less common vocabulary/collocations. Good paraphrasing skills.
   - 6.0: Wide enough vocabulary for topics but lacks precision or appropriate style at times.
   - 5.0: Limited vocabulary for familiar topics. Repetitive word choices.
   - 4.0: Only basic vocabulary. Unable to convey complex ideas.
   - 3.0: Uses only very basic words for personal information. High frequency of errors.
   - 2.0: Only isolated words or memorized phrases. No real vocabulary range.
3. GRAMMATICAL RANGE & ACCURACY (GRA):
   - 9.0: Natural use of full range of structures. Consistently accurate.
   - 8.0: Wide range of complex structures flexibly used. Majority of sentences error-free.
   - 7.0: Mix of simple and complex structures. Many error-free sentences.
   - 6.0: Mix of simple and complex forms but with limited flexibility; errors persist.
   - 5.0: Relies on simple sentences. Frequent errors impede communication.
   - 4.0: Basic sentence forms only. Frequent errors cause misunderstandings.
   - 3.0: Attempts basic sentence forms but with very high error rate. Communication is limited.
   - 2.0: Cannot produce complete sentences. Only basic word fragments.
4. PRONUNCIATION (P) - [Estimated via Transcript Clarity]:
   - 9.0: Crystal clear. All words accurately transcribed by STT.
   - 7.5: High clarity. Complex words are captured correctly.
   - 6.0: Moderate clarity. Some mispronunciations lead to minor STT errors.
   - 4.0: Significant mispronunciations causing STT to fail frequently.
   - 2.0: Speech is almost unintelligible. STT fails to capture most words accurately.
`;

// Protect all speaking routes
speakingRouter.use('/*', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  return jwt({ secret, alg: 'HS256' })(c, next);
});

// JSON Repair Helper
function cleanAndParseJSON(jsonStr: string): any {
  const startIdx = jsonStr.indexOf('{');
  const endIdx = jsonStr.lastIndexOf('}');
  if (startIdx === -1 || endIdx === -1) {
    return null;
  }
  let cleaned = jsonStr.substring(startIdx, endIdx + 1);
  cleaned = cleaned.replace(/[\n\r\t]/g, ' ');
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    return null;
  }
}

// Decode base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Get standard KV session context key
const getKVKey = (id: string) => `speaking:ctx:${id}`;

// 0. POST /transcribe
speakingRouter.post('/transcribe', aiRateLimit, async (c) => {
  const { audio } = await c.req.json();
  if (!audio) return c.json({ success: false, error: 'No audio provided' }, 400);
  
  try {
    const audioBuffer = base64ToUint8Array(audio);
    const sttResult = await c.env.AI.run('@cf/openai/whisper', {
      audio: [...audioBuffer]
    });
    return c.json({ success: true, data: { transcript: sttResult.text } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 1. POST /session/start

speakingRouter.post('/session/start', aiRateLimit, async (c) => {
  try {
    const payload = c.get('jwtPayload') as any;
    const userId = payload.sub;
    const { personaId, topic, part, lesson_id } = await c.req.json();
    const db = drizzle(c.env.DB);
    const sessionId = crypto.randomUUID();

    let sessionTopic = topic;
    let partsList = part ? [parseInt(part)] : [1];
    let fullContent: any = null;

    // Load structured data if lesson_id provided
    if (lesson_id) {
      const lesson = await db.select().from(lessons).where(eq(lessons.id, lesson_id)).get();
      if (lesson) {
        sessionTopic = lesson.title;
        if (lesson.lesson_parts) {
          partsList = Array.isArray(lesson.lesson_parts) ? lesson.lesson_parts : JSON.parse(lesson.lesson_parts as any);
        }
        if (lesson.content) {
          try {
            fullContent = typeof lesson.content === 'string' ? JSON.parse(lesson.content) : lesson.content;
          } catch {
            fullContent = { legacy_content: lesson.content };
          }
        }
      }
    }

    const persona = PERSONAS[personaId as keyof typeof PERSONAS] || PERSONAS.james;
    const currentPart = partsList[0];
    const isPractice = sessionTopic === 'Free Practice';

    // Create AI Instruction based on structured content
    let partInstruction = `Topic: ${sessionTopic}.`;
    if (fullContent) {
      const pData = fullContent[`part${currentPart}`];
      if (pData) partInstruction += ` Focus on these cues: ${JSON.stringify(pData)}.`;
    }

    const openingPrompt = isPractice
      ? `You are the friendly IELTS speaking examiner ${persona.name}. Start a free practice conversational session. Generate a friendly opening greeting and the first general question. Under 35 words. Return STRICT JSON: { "response": "..." }`
      : `You are the IELTS speaking examiner ${persona.name}. 
Start an official Mock Test Part ${currentPart}. 
Context: ${partInstruction}
Available Parts in this session: ${partsList.join(', ')}.

MANDATE: 
- Generate a professional opening greeting.
- Ask the first question for Part ${currentPart}.
- Keep it under 35 words. 
- Return STRICT JSON: { "response": "..." }`;

    const aiRes = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: openingPrompt }]
    });

    const parsed = cleanAndParseJSON(aiRes.response || '{}');
    const greeting = parsed.response || (isPractice ? "Hello! Let's practice. How are you today?" : `Hello. Let's start the speaking exam. Can you introduce yourself and tell me about ${sessionTopic}?`);

    await db.insert(speakingSessions).values({
      id: sessionId,
      user_id: userId,
      lesson_id: lesson_id || null,
      persona_id: personaId,
      topic: sessionTopic,
      part: currentPart,
      status: 'active',
      turn_count: 0,
      started_at: new Date()
    }).run();

    const ctx = {
      sessionId, userId, personaId, 
      topic: sessionTopic, 
      partsList,
      currentPartIndex: 0,
      fullContent,
      conversationHistory: [
        { role: 'assistant', content: greeting }
      ],
      turnCount: 0,
      partTurnCount: 0,
      bandScores: []
    };

    await c.env.CACHE.put(getKVKey(sessionId), JSON.stringify(ctx), { expirationTtl: 7200 });

    return c.json({ success: true, data: { sessionId, opening_question: greeting } });
  } catch (err: any) {
    console.error('Session start error:', err.message, err.stack);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 2. POST /session/turn
speakingRouter.post('/session/turn', aiRateLimit, async (c) => {
  try {
    const { sessionId, audio } = await c.req.json();
    const db = drizzle(c.env.DB);

    const rawCtx = await c.env.CACHE.get(getKVKey(sessionId));
    if (!rawCtx) {
      return c.json({ success: false, error: 'Session context not found or expired' }, 404);
    }
    const context = JSON.parse(rawCtx);

    const audioBytes = base64ToUint8Array(audio);
    let transcript = '';
    try {
      const stt = await c.env.AI.run('@cf/openai/whisper', {
        audio: Array.from(audioBytes)
      });
      transcript = stt.text || '';
    } catch (error: any) {
      console.error('Whisper STT Error:', error.message);
      transcript = '[Unrecognized speech or unsupported language detected]';
    }

    const persona = PERSONAS[context.personaId as keyof typeof PERSONAS] || PERSONAS.james;
    const isPractice = context.topic === 'Free Practice';
    
    // Check for Part 2 specifics (Long turn)
    const isPart2 = context.partsList[context.currentPartIndex] === 2;
    
    const DESCRIPTORS = IELTS_BAND_DESCRIPTORS;
    const systemPrompt = `
You are an expert, extremely strict official IELTS Speaking Examiner.
Your Identity: ${persona.systemPrompt}
Session: ${isPractice ? 'FREE PRACTICE' : `OFFICIAL MOCK TEST PART ${context.partsList[context.currentPartIndex]} on "${context.topic}"`}
Available Structure: ${JSON.stringify(context.partsList)} (Current Index: ${context.currentPartIndex})
Full Exam Content: ${JSON.stringify(context.fullContent)}

${IELTS_BAND_DESCRIPTORS}

### EVALUATION MANDATES:
1. Chain of Thought: Deeply analyze EACH of the 4 criteria BEFORE deciding the final score.
2. Stinginess: Do NOT award Band 7.0+ unless the candidate uses complex academic vocabulary and sophisticated grammar.
3. TRANSITION MANDATE (CRITICAL):
   - Part 1: Ask 3-4 questions. Then return "transition_to_part": 2.
   - Part 2: Give the Cue Card prompt. Wait for user. Once they speak, evaluate and return "transition_to_part": 3.
   - Part 3: Ask 3-4 abstract questions. Then return "next_question": null to end.
   - If a transition is needed, set the "transition_to_part" field in JSON.

### OUTPUT JSON SCHEMA:
{
  "response": "Brief English response as examiner (<30 words)",
  "transition_to_part": number | null,
  "evaluation_metadata": { ... },
  ...
}
Respond ONLY with raw JSON.`;

    const aiRes = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        ...context.conversationHistory,
        { role: 'user', content: transcript }
      ],
      max_tokens: 1024
    });

    const parsedRes = cleanAndParseJSON(aiRes.response || '{}');

    // Tính band thực từ transcript để clamping (phòng hờ AI hallucination)
    const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
    let fallbackBand = 1.0;
    if (wordCount < 10) fallbackBand = 2.0;
    else if (wordCount < 25) fallbackBand = 4.0;
    else if (wordCount < 50) fallbackBand = 5.5;
    else fallbackBand = 6.5;

    // Build feedback — use parsedRes if valid, otherwise fall back to safe defaults
    // IMPORTANT: must be done BEFORE reading any field from parsedRes (it may be null)
    const feedback = parsedRes ?? {
      response: "Thank you for your answer.",
      feedback_vi: { strengths: "N/A", weaknesses: "Câu trả lời quá ngắn", action_plan: "Hãy nói dài hơn" },
      band_estimate: fallbackBand,
      fluency: fallbackBand,
      lexicalResource: fallbackBand,
      grammaticalRange: fallbackBand,
      pronunciation: fallbackBand,
      correction: null,
      next_question: null,
      transition_to_part: null,
    };

    // Logic: Handle Transition if AI requested
    const transitionTo = feedback.transition_to_part ?? null;
    if (transitionTo && context.partsList.includes(transitionTo)) {
      context.currentPartIndex = context.partsList.indexOf(transitionTo);
      context.partTurnCount = 0;

      // Update DB with new part
      await db.update(speakingSessions)
        .set({ part: transitionTo })
        .where(eq(speakingSessions.id, sessionId))
        .run();
    }
    
    // UI/DB Compatibility Mapping:
    // Nếu AI dùng schema mới, ta map feedback_vi.weaknesses vào trường 'feedback' cũ để không lỗi UI
    if (feedback.feedback_vi) {
      (feedback as any).feedback = `${feedback.feedback_vi.weaknesses}. ${feedback.feedback_vi.action_plan}`;
    }

    const maxAllowedBand = wordCount < 12 ? 2.5
      : wordCount < 25 ? 4.5
      : wordCount < 40 ? 5.5
      : wordCount < 60 ? 7.0
      : 9.0;

    const roundToHalf = (num: number) => Math.round(num * 2) / 2;

    feedback.band_estimate = roundToHalf(Math.min(feedback.band_estimate ?? fallbackBand, maxAllowedBand));
    feedback.fluency = roundToHalf(Math.min(feedback.fluency ?? feedback.band_estimate, maxAllowedBand));
    feedback.lexicalResource = roundToHalf(Math.min(feedback.lexicalResource ?? feedback.band_estimate, maxAllowedBand));
    feedback.grammaticalRange = roundToHalf(Math.min(feedback.grammaticalRange ?? feedback.band_estimate, maxAllowedBand));
    feedback.pronunciation = roundToHalf(Math.min(feedback.pronunciation ?? feedback.band_estimate, maxAllowedBand));

    context.conversationHistory.push({ role: 'user', content: transcript });
    context.conversationHistory.push({ role: 'assistant', content: feedback.response || '' });
    if (context.conversationHistory.length > 10) {
      context.conversationHistory = context.conversationHistory.slice(-10);
    }
    context.turnCount += 1;
    context.partTurnCount += 1;
    if (feedback.band_estimate) {
      context.bandScores.push(feedback.band_estimate);
    }

    await c.env.CACHE.put(getKVKey(sessionId), JSON.stringify(context), { expirationTtl: 7200 });

    await db.insert(speakingTurns).values({
      id: crypto.randomUUID(),
      session_id: sessionId,
      transcript,
      ai_response: JSON.stringify(feedback),
      band_estimate: feedback.band_estimate ?? 0.0
    }).run();

    await db.update(speakingSessions)
      .set({ turn_count: context.turnCount })
      .where(eq(speakingSessions.id, sessionId))
      .run();

    return c.json({ success: true, data: { transcript, transition_to_part: feedback.transition_to_part, ...feedback } });
  } catch (err: any) {
    console.error('Turn error:', err.message, err.stack);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 3. POST /session/end
speakingRouter.post('/session/end', async (c) => {
  try {
    const { sessionId } = await c.req.json();
    const db = drizzle(c.env.DB);

    const payload = c.get('jwtPayload') as any;
    const userId = payload.sub;

    // Lấy tier của user
    const user = await db.select({ tier: users.tier }).from(users).where(eq(users.id, userId)).get();
    const isPremium = user?.tier === 'premium';

    const reportAvailableAt = isPremium ? new Date() : new Date(Date.now() + SPEAKING_REPORT_DELAY_MS);

    if (!isPremium) {
      if (c.env.SPEAKING_QUEUE) {
        await c.env.SPEAKING_QUEUE.send({
          sessionId,
          userId,
          isPremium,
          reportAvailableAtStr: reportAvailableAt.toISOString()
        });
      } else {
        console.warn('SPEAKING_QUEUE not bound, falling back to sync processing');
        c.executionCtx.waitUntil(processSpeakingReport(c.env, sessionId, userId, isPremium, reportAvailableAt.toISOString()));
      }

      await sendPushNotification(c.env.DB, userId, {
        title: '🎤 Báo cáo Speaking đang được tổng hợp',
        body: `Kết quả sẽ có trong mục Lịch sử sau ~5 phút.`,
        data: { type: 'speaking_report_queued', session_id: sessionId },
      });

      return c.json({
        success: true,
        data: {
          scoring_mode: 'deferred',
          report_available_at: reportAvailableAt.toISOString(),
          estimated_wait_minutes: 5,
          message: 'Báo cáo đang được tổng hợp. Kết quả sẽ xuất hiện trong mục Lịch sử sau ~5 phút.',
        },
      });
    }

    // Premium: trả về full report ngay
    const finalReport = await processSpeakingReport(c.env, sessionId, userId, isPremium, reportAvailableAt.toISOString());
    return c.json({ success: true, data: { report: finalReport, scoring_mode: 'immediate' } });
  } catch (err: any) {
    console.error('End session error:', err.message, err.stack);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 5. POST /sessions/:session_id/unlock — fake ads unlock cho free user
speakingRouter.post('/sessions/:session_id/unlock', async (c) => {
  const sessionId = c.req.param('session_id');
  const payload = c.get('jwtPayload') as any;
  const userId = payload.sub;
  const db = drizzle(c.env.DB);

  const session = await db.select()
    .from(speakingSessions)
    .where(eq(speakingSessions.id, sessionId))
    .get();

  if (!session || session.user_id !== userId) {
    return c.json({ success: false, error: 'Session not found' }, 404);
  }
  if (session.status !== 'completed') {
    return c.json({ success: false, error: 'Session not completed yet' }, 400);
  }
  if (session.report_unlocked) {
    return c.json({ success: true, data: { already_unlocked: true, report: session.report } });
  }

  await db.update(speakingSessions)
    .set({ report_unlocked: true })
    .where(eq(speakingSessions.id, sessionId))
    .run();

  return c.json({ success: true, data: { unlocked: true, report: session.report } });
});

// 4. GET /sessions
speakingRouter.get('/sessions', async (c) => {
  const payload = c.get('jwtPayload') as any;
  const userId = payload.sub;
  const db = drizzle(c.env.DB);

  const sessions = await db.select()
    .from(speakingSessions)
    .where(eq(speakingSessions.user_id, userId))
    .orderBy(desc(speakingSessions.started_at))
    .all();

  return c.json({ success: true, data: { sessions } });
});

// GET /sessions/:id
speakingRouter.get('/sessions/:id', async (c) => {
  const sessionId = c.req.param('id');
  const payload = c.get('jwtPayload') as any;
  const userId = payload.sub;
  const db = drizzle(c.env.DB);

  const session = await db.select()
    .from(speakingSessions)
    .where(and(eq(speakingSessions.id, sessionId), eq(speakingSessions.user_id, userId)))
    .get();

  if (!session) {
    return c.json({ success: false, error: 'Session not found' }, 404);
  }

  // Parse report if it's a string
  const report = session.report ? (typeof session.report === 'string' ? JSON.parse(session.report) : session.report) : null;

  return c.json({ success: true, data: { ...session, report } });
});

export default speakingRouter;
