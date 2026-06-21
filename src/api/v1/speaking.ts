import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, and } from 'drizzle-orm';
import type { Bindings } from '../../index';
import { speakingSessions, speakingTurns, users, lessons, questionGroups, questions, passages, userProgress } from '../../db/schema';
import { aiRateLimit } from '../../middleware/rateLimit';
import { sql } from 'drizzle-orm';
import { sendPushNotification } from '../../services/push.service';
import { processSpeakingReport } from '../../workers/speaking-consumer';
import { requireJwtSecret } from '../../middleware/auth';

const SPEAKING_REPORT_DELAY_MS = 5 * 60 * 1000; // 5 phút cho free user

const JSON_CHAT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

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
  const secret = requireJwtSecret(c);
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

    const user = await db.select({ tier: users.tier }).from(users).where(eq(users.id, userId)).get();
    const isPremium = user?.tier === 'premium';

    // --- Giới hạn số lần làm bài (Attempt Limit) ---
    if (lesson_id) {
      const { count } = await import('drizzle-orm');
      const stats = await db.select({ value: count() })
        .from(speakingSessions)
        .where(and(
          eq(speakingSessions.user_id, userId),
          eq(speakingSessions.lesson_id, lesson_id),
          eq(speakingSessions.status, 'completed')
        ))
        .get();
      
      const limit = isPremium ? 100 : 1;
      if (stats && (stats.value || 0) >= limit) {
        return c.json({ success: false, error: `Bài học này đã hoàn thành. ${isPremium ? '' : 'Mỗi bài chỉ được làm 1 lần.'}` }, 403);
      }
    }

    // --- Giới hạn ngày (Daily Limit) ---
    if (!isPremium) {
      const { count } = await import('drizzle-orm');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTs = today.getTime();

      const testDone = await db.select({ value: count() })
        .from(userProgress)
        .where(and(
          eq(userProgress.user_id, userId),
          eq(userProgress.status, 'completed'),
          sql`${userProgress.completed_at} >= ${todayTs}`
        ))
        .get();

      const speakingDone = await db.select({ value: count() })
        .from(speakingSessions)
        .where(and(
          eq(speakingSessions.user_id, userId),
          eq(speakingSessions.status, 'completed'),
          sql`${speakingSessions.ended_at} >= ${todayTs}`
        ))
        .get();

      const totalToday = (testDone?.value || 0) + (speakingDone?.value || 0);
      if (totalToday >= 3) {
        return c.json({ success: false, error: "Bạn đã đạt giới hạn nộp 3 bài mỗi ngày cho tài khoản Miễn phí." }, 403);
      }
    }

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
            if (typeof fullContent === 'string') {
              fullContent = { legacy_content: fullContent };
            }
          } catch {
            fullContent = { legacy_content: lesson.content };
          }
        }
      }
    }

    const persona = PERSONAS[personaId as keyof typeof PERSONAS] || PERSONAS.james;
    const currentPart = partsList[0];
    const isPractice = sessionTopic === 'Free Practice';

    // Extract questions directly from relational DB (passages → question_groups → questions)
    // This is the CORRECT source of truth — Admin CMS saves here, NOT to lessons.content
    let extractedQuestions: any[] = [];
    if (lesson_id && !isPractice) {
      const groups = await db.select()
        .from(questionGroups)
        .where(eq(questionGroups.lesson_id, lesson_id))
        .all();

      // Ensure we only take one group per part (in case of duplicates created by Admin UI bugs)
      const uniqueGroups = new Map<number, any>();
      for (const group of groups) {
        uniqueGroups.set(Number(group.part) || 1, group);
      }
      
      const distinctGroups = Array.from(uniqueGroups.values());
      distinctGroups.sort((a, b) => (Number(a.part) || 1) - (Number(b.part) || 1));

      for (const group of distinctGroups) {
        const pNum = Number(group.part) || 1;

        const groupQuestions = await db.select()
          .from(questions)
          .where(eq(questions.group_id, group.id))
          .all();

        if (pNum === 2) {
          // For Part 2, cue card is stored in the passage's content_html
          let cueCard = '';
          if (group.passage_id) {
            const passage = await db.select()
              .from(passages)
              .where(eq(passages.id, group.passage_id))
              .get();
            cueCard = passage?.content_html || '';
          }
          let fullCueCardText = cueCard;
          if (groupQuestions.length > 0) {
            const bullets = groupQuestions.map(q => q.content).join('\n');
            fullCueCardText += '\n\n' + bullets;
          }

          if (cueCard) {
            extractedQuestions.push({
              part: 2,
              question: `Now, I'm going to give you a topic and I'd like you to talk about it for 1 to 2 minutes. Before you talk, you'll have 1 minute to think about what you're going to say. Here is your topic: ${cueCard}`,
              cueCardText: fullCueCardText
            });
          }
        } else {
          // Part 1 and Part 3: each question row = one examiner question
          groupQuestions.forEach(q => {
            extractedQuestions.push({ part: pNum, question: q.content });
          });
        }
      }
    }

    let greeting = `Hello, my name is ${persona.name}. I will be your examiner today. Could you tell me your full name, please?`;
    let preGeneratedQuestions = extractedQuestions;

    // Use AI only if it's Free Practice OR we failed to extract questions from fullContent
    if (isPractice || preGeneratedQuestions.length === 0) {
      const openingPrompt = isPractice
        ? `You are the friendly IELTS examiner ${persona.name}. Start a free practice session on "${sessionTopic}". Generate a brief greeting and 3 general questions. Return STRICT JSON: { "greeting": "...", "questions": [ { "part": 1, "question": "..." } ] }`
        : `You are IELTS examiner ${persona.name}. Generate exact questions for a test on "${sessionTopic}". Available Parts: ${partsList.join(', ')}. Return STRICT JSON: { "greeting": "...", "questions": [ { "part": number, "question": "..." } ] }`;

      const aiRes = await c.env.AI.run(JSON_CHAT_MODEL, {
        messages: [{ role: 'user', content: openingPrompt }],
        max_tokens: 2048
      });

      const parsed = cleanAndParseJSON(aiRes.response || '{}') ?? {};
      greeting = parsed.greeting || greeting;
      
      const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
      preGeneratedQuestions = rawQuestions.length > 0 ? rawQuestions : [
         { part: 1, question: `Can you tell me a bit about ${sessionTopic}?` },
         { part: 1, question: `What aspects of ${sessionTopic} do you enjoy the most?` },
         { part: 1, question: "Do you plan to continue exploring this topic in the future?" }
      ];
    }

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
      bandScores: [],
      preGeneratedQuestions,
      currentQuestionIndex: -1
    };

    await c.env.CACHE.put(getKVKey(sessionId), JSON.stringify(ctx), { expirationTtl: 7200 });

    const part2Q = preGeneratedQuestions.find((q: any) => q.part === 2 && q.cueCardText);
    const cueCardText = part2Q ? part2Q.cueCardText : null;

    return c.json({ 
      success: true, 
      data: { 
        sessionId, 
        opening_question: greeting,
        cue_card_text: cueCardText,
        parts: partsList
      } 
    });
  } catch (err: any) {
    console.error('Session start error:', err.message, err.stack);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 2. POST /session/turn
speakingRouter.post('/session/turn', aiRateLimit, async (c) => {
  try {
    const { sessionId, audio, silenceMetadata } = await c.req.json();
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
    
    // --- Optimized: No per-turn scoring ---
    // Instead of calling Llama to evaluate and generate the next question, 
    // we just pop the next question from our pre-generated list.

    const nextQuestionObj = context.preGeneratedQuestions[context.currentQuestionIndex + 1];
    const responseText = nextQuestionObj ? nextQuestionObj.question : "That is the end of the speaking test. Thank you.";

    let transitionToPart: number | null = null;
    // Handle part transition if the next question belongs to a different part
    if (nextQuestionObj && context.partsList[context.currentPartIndex] !== nextQuestionObj.part) {
      transitionToPart = nextQuestionObj.part;
      context.currentPartIndex = context.partsList.indexOf(nextQuestionObj.part);
      context.partTurnCount = 0;
      await db.update(speakingSessions)
        .set({ part: nextQuestionObj.part })
        .where(eq(speakingSessions.id, sessionId))
        .run();
    }

    context.currentQuestionIndex += 1;
    context.conversationHistory.push({ role: 'user', content: transcript });
    context.conversationHistory.push({ role: 'assistant', content: responseText });
    if (context.conversationHistory.length > 10) {
      context.conversationHistory = context.conversationHistory.slice(-10);
    }
    context.turnCount += 1;
    context.partTurnCount += 1;

    await c.env.CACHE.put(getKVKey(sessionId), JSON.stringify(context), { expirationTtl: 7200 });

    await db.insert(speakingTurns).values({
      id: crypto.randomUUID(),
      session_id: sessionId,
      transcript: transcript,
      ai_response: JSON.stringify({ response: responseText }),
      silence_metadata: silenceMetadata ? JSON.stringify(silenceMetadata) : null
    }).run();

    await db.update(speakingSessions)
      .set({ turn_count: context.turnCount })
      .where(eq(speakingSessions.id, sessionId))
      .run();

    const isSessionDone = !nextQuestionObj;
    return c.json({ success: true, data: { transcript, response: responseText, is_session_done: isSessionDone, transition_to_part: transitionToPart } });
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
