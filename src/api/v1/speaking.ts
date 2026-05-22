import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc } from 'drizzle-orm';
import type { Bindings } from '../../index';
import { speakingSessions, speakingTurns } from '../../db/schema';

const speakingRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

export const PERSONAS = {
  james: {
    id: 'james', name: 'James', accent: 'en-GB',
    systemPrompt: `You are James, a formal British IELTS examiner. Style: Polite but strict. Always respond with ONLY valid JSON.`
  },
  emily: {
    id: 'emily', name: 'Emily', accent: 'en-AU',
    systemPrompt: `You are Emily, a warm Australian IELTS coach. Style: Encouraging, sandwich feedback. Always respond with ONLY valid JSON.`
  },
  dr_chen: {
    id: 'dr_chen', name: 'Dr. Chen', accent: 'en-US',
    systemPrompt: `You are Dr. Chen, a linguistics professor and IELTS examiner. Style: Intellectual, push for abstract thinking. Always respond with ONLY valid JSON.`
  },
  sarah: {
    id: 'sarah', name: 'Sarah', accent: 'en-US',
    systemPrompt: `You are Sarah, a high-energy American IELTS trainer. Style: Fast-paced, simulate exam pressure. Always respond with ONLY valid JSON.`
  }
};

const IELTS_BAND_DESCRIPTORS = `
FLUENCY & COHERENCE:
- Band 9: Fluent with rare self-correction; hesitation only content-related
- Band 8: Occasional self-correction; hesitation usually content-related
- Band 7: Speaks at length without effort; some language-related hesitation
- Band 6: Willing to speak at length; may lose coherence, repeat, self-correct

LEXICAL RESOURCE:
- Band 9: Full flexibility and precision across all topics
- Band 8: Wide vocabulary; conveys precise meaning flexibly
- Band 7: Flexible vocabulary; uses some less common and idiomatic items
- Band 6: Wide enough vocabulary for topics; meaning clear despite errors

GRAMMATICAL RANGE & ACCURACY:
- Band 9: Full range of structures naturally; consistently accurate
- Band 8: Wide range flexibly; frequent error-free sentences
- Band 7: Range of complex structures; frequently error-free
- Band 6: Mix of simple and complex; limited flexibility; frequent mistakes

PRONUNCIATION:
- Band 9: Full range of features with precision and subtlety
- Band 8: Wide range of features; flexible use
- Band 7: Positive features of Band 6 plus some of Band 8
- Band 6: Range of features with mixed control
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
speakingRouter.post('/transcribe', async (c) => {
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
speakingRouter.post('/session/start', async (c) => {
  const payload = c.get('jwtPayload') as any;
  const userId = payload.sub;
  const { personaId, topic, part } = await c.req.json();
  const db = drizzle(c.env.DB);
  const sessionId = crypto.randomUUID();

  const persona = PERSONAS[personaId as keyof typeof PERSONAS] || PERSONAS.james;
  const isPractice = topic === 'Free Practice';
  const openingPrompt = isPractice
    ? `You are the friendly IELTS speaking examiner ${persona.name}. Start a free practice conversational session. Generate a friendly opening greeting and the first general question. Under 35 words. Return STRICT JSON: { "response": "..." }`
    : `You are the IELTS speaking examiner ${persona.name}. Start an official Mock Test Part ${part}. Topic: ${topic}. Generate the opening greeting and give the prompt/question for the topic. Under 35 words. Return STRICT JSON: { "response": "..." }`;

  const aiRes = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [{ role: 'user', content: openingPrompt }]
  });

  const parsed = cleanAndParseJSON(aiRes.response || '{}');
  const greeting = parsed.response || (isPractice ? "Hello! Let's practice. How are you today?" : `Hello. Let's start the speaking exam. Can you introduce yourself and tell me about ${topic}?`);

  await db.insert(speakingSessions).values({
    id: sessionId,
    user_id: userId,
    persona_id: personaId,
    topic,
    part: parseInt(part) || 1,
    status: 'active',
    turn_count: 0
  }).run();

  const ctx = {
    sessionId, userId, personaId, topic, part: parseInt(part) || 1,
    conversationHistory: [
      { role: 'assistant', content: greeting }
    ],
    turnCount: 0,
    bandScores: []
  };

  await c.env.CACHE.put(getKVKey(sessionId), JSON.stringify(ctx), { expirationTtl: 7200 });

  return c.json({ success: true, data: { sessionId, opening_question: greeting } });
});

// 2. POST /session/turn
speakingRouter.post('/session/turn', async (c) => {
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
      // language parameter is not supported by all CF AI models, but we can try catching the error
    });
    transcript = stt.text || '';
  } catch (error: any) {
    console.error('Whisper STT Error:', error.message);
    transcript = '[Unrecognized speech or unsupported language detected]';
  }

  const persona = PERSONAS[context.personaId as keyof typeof PERSONAS] || PERSONAS.james;
  const isPractice = context.topic === 'Free Practice';
  
  const DESCRIPTORS = IELTS_BAND_DESCRIPTORS;
  const systemPrompt = isPractice
    ? `${persona.systemPrompt}
This is a FREE PRACTICE speaking session.
${DESCRIPTORS}
Evaluate the user's transcript against the 4 criteria above.
Provide short, encouraging Vietnamese feedback.
Output per-criterion band (0-9) and overall band_estimate.
Short examiner response (<40 words) in "response".
Next conversational question in "next_question".
STRICT JSON output: { "response": "English response", "feedback": "Tiếng Việt", "band_estimate": number, "fluency": number, "lexicalResource": number, "grammaticalRange": number, "pronunciation": number, "correction": "Corrected sentence or null", "next_question": "English follow-up or null" }`
    : `${persona.systemPrompt}
You are conducting an OFFICIAL MOCK TEST Part ${context.part} on the strict topic: "${context.topic}".
${DESCRIPTORS}
CRITICAL RULES:
- If answer is 1-2 sentences, MAXIMUM overall band is 4.0
- If off-topic, MAXIMUM overall band is 2.0
Evaluate the transcript against the 4 criteria above.
Output per-criterion band (0-9) and overall band_estimate.
Vietnamese feedback. Short examiner response (<40 words) in "response".
Next question strictly related to the topic in "next_question" (or null to end).
STRICT JSON output: { "response": "English response", "feedback": "Tiếng Việt", "band_estimate": number, "fluency": number, "lexicalResource": number, "grammaticalRange": number, "pronunciation": number, "correction": "Corrected sentence or null", "next_question": "English follow-up or null" }`;

  const aiRes = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      { role: 'system', content: systemPrompt },
      ...context.conversationHistory,
      { role: 'user', content: transcript }
    ],
    max_tokens: 512
  });

  const feedback = cleanAndParseJSON(aiRes.response || '{}') || {
    response: "Thank you for your answer. Let's move on.",
    feedback: "Câu trả lời của bạn đã được ghi nhận.",
    band_estimate: 6.0,
    fluency: 6.0, lexicalResource: 6.0,
    grammaticalRange: 6.0, pronunciation: 6.0,
    correction: null,
    next_question: null
  };
  
  context.conversationHistory.push({ role: 'user', content: transcript });
  context.conversationHistory.push({ role: 'assistant', content: feedback.response || '' });
  if (context.conversationHistory.length > 10) {
    context.conversationHistory = context.conversationHistory.slice(-10);
  }
  context.turnCount += 1;
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

  return c.json({ success: true, data: { transcript, ...feedback } });
});

// 3. POST /session/end
speakingRouter.post('/session/end', async (c) => {
  const { sessionId } = await c.req.json();
  const db = drizzle(c.env.DB);

  const turns = await db.select().from(speakingTurns).where(eq(speakingTurns.session_id, sessionId)).all();
  const session = await db.select().from(speakingSessions).where(eq(speakingSessions.id, sessionId)).get();
  const avgBand = turns.length > 0 ? turns.reduce((acc, t) => acc + (t.band_estimate ?? 0), 0) / turns.length : 6.0;
  const duration = session?.started_at
    ? Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000)
    : 300;

  const rawCtx = await c.env.CACHE.get(getKVKey(sessionId));
  const context = rawCtx ? JSON.parse(rawCtx) : { personaId: 'james', topic: 'Speaking test', part: 1 };

  const turnDetails = turns.map((t, i) => {
    const ai = t.ai_response as Record<string, any> | null;
    return `Turn ${i + 1}:
Transcript: "${t.transcript}"
Scores: overall=${t.band_estimate ?? 'N/A'}, fluency=${ai?.fluency ?? 'N/A'}, lexical=${ai?.lexicalResource ?? 'N/A'}, grammar=${ai?.grammaticalRange ?? 'N/A'}, pronunciation=${ai?.pronunciation ?? 'N/A'}`;
  }).join('\n\n');

  const DESCRIPTORS = IELTS_BAND_DESCRIPTORS;
  const reportPrompt = `You are an IELTS Speaking examiner. Generate a consolidated speaking report.

${DESCRIPTORS}

Session info:
- Persona: ${context.personaId}
- Topic: "${context.topic}"
- Part: ${context.part}
- Duration: ${duration} seconds
- Total turns: ${turns.length}

Full conversation with per-turn scores:
${turnDetails}

Analyze ALL turns against the IELTS band descriptors above.
Output a consolidated report with:
- averageBandEstimate: weighted overall band across all turns
- breakdown: { fluency, lexicalResource, grammaticalRange, pronunciation } — computed by analyzing EVERY turn's transcript against the criteria. Do NOT copy the same number to all 4; each must be independently assessed.
- topErrors: extract actual language errors from transcripts (grammar, word choice, etc.). Empty array only if truly error-free.
- nextSessionSuggestion: specific Vietnamese advice based on actual weaknesses observed

STRICT JSON output:
{
  "sessionId": "${sessionId}",
  "persona": "${context.personaId}",
  "duration": ${duration},
  "turnsCompleted": ${turns.length},
  "averageBandEstimate": number,
  "breakdown": { "fluency": number, "lexicalResource": number, "grammaticalRange": number, "pronunciation": number },
  "topErrors": [{"type": "grammar|vocabulary|pronunciation", "example": "student's words", "correction": "corrected version"}],
  "nextSessionSuggestion": "Tiếng Việt suggestion"
}`;

  const aiRes = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [{ role: 'user', content: reportPrompt }]
  });

  const avgFromTurns = (key: string): number => {
    const vals = turns.map(t => (t.ai_response as Record<string, any> | null)?.[key]).filter(v => v != null) as number[];
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : avgBand;
  };

  const finalReport = cleanAndParseJSON(aiRes.response || '{}') || {
    sessionId, persona: context.personaId, duration, turnsCompleted: turns.length,
    averageBandEstimate: avgBand,
    breakdown: {
      fluency: avgFromTurns('fluency'),
      lexicalResource: avgFromTurns('lexicalResource'),
      grammaticalRange: avgFromTurns('grammaticalRange'),
      pronunciation: avgFromTurns('pronunciation'),
    },
    topErrors: [], nextSessionSuggestion: "Cố gắng luyện tập thêm nhé!"
  };

  await db.update(speakingSessions)
    .set({
      status: 'completed',
      average_band: avgBand,
      report: JSON.stringify(finalReport),
      ended_at: new Date()
    })
    .where(eq(speakingSessions.id, sessionId))
    .run();

  await c.env.CACHE.delete(getKVKey(sessionId));

  return c.json({ success: true, data: { report: finalReport } });
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

export default speakingRouter;
