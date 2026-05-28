import { MessageBatch, ExecutionContext } from '@cloudflare/workers-types';
import { Bindings } from '../index';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { speakingSessions, speakingTurns } from '../db/schema';
import { sendPushNotification } from '../services/push.service';

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

function cleanAndParseJSON(jsonStr: string): any {
  const startIdx = jsonStr.indexOf('{');
  const endIdx = jsonStr.lastIndexOf('}');
  if (startIdx === -1 || endIdx === -1) return null;
  let cleaned = jsonStr.substring(startIdx, endIdx + 1);
  cleaned = cleaned.replace(/[\n\r\t]/g, ' ');
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(cleaned); } catch (e) { return null; }
}

export async function processSpeakingReport(env: Bindings, sessionId: string, userId: string, isPremium: boolean, reportAvailableAtStr: string) {
  const db = drizzle(env.DB);
  const now = new Date();
  
  const turns = await db.select().from(speakingTurns).where(eq(speakingTurns.session_id, sessionId)).all();
  const session = await db.select().from(speakingSessions).where(eq(speakingSessions.id, sessionId)).get();
  
  const avgBand = turns.length > 0 ? turns.reduce((acc, t) => acc + (t.band_estimate ?? 0), 0) / turns.length : 0.0;
  
  // Calculate duration: ended_at (now) - started_at
  let duration = 300;
  if (session?.started_at) {
    const startTime = new Date(session.started_at).getTime();
    duration = Math.round((now.getTime() - startTime) / 1000);
    if (duration < 0) duration = 0;
  }
  
  const rawCtx = await env.CACHE.get(`speaking:ctx:${sessionId}`);
  const context = rawCtx ? JSON.parse(rawCtx) : { personaId: 'james', topic: 'Speaking test', part: 1 };
  
  const turnDetails = turns.map((t, i) => {
    const ai = typeof t.ai_response === 'string' ? JSON.parse(t.ai_response) : t.ai_response as Record<string, any> | null;
    return `Turn ${i + 1}:\nTranscript: "${t.transcript}"\nScores: overall=${t.band_estimate ?? 'N/A'}, fluency=${ai?.fluency ?? 'N/A'}, lexical=${ai?.lexicalResource ?? 'N/A'}, grammar=${ai?.grammaticalRange ?? 'N/A'}, pronunciation=${ai?.pronunciation ?? 'N/A'}`;
  }).join('\n\n');

  const reportPrompt = `You are an IELTS Speaking examiner. Generate a consolidated speaking report.
${IELTS_BAND_DESCRIPTORS}
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
- breakdown: { fluency, lexicalResource, grammaticalRange, pronunciation } — computed by analyzing EVERY turn's transcript against the criteria.
- topErrors: extract actual language errors from transcripts. Empty array only if truly error-free.
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

  const aiRes = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [{ role: 'user', content: reportPrompt }]
  });

  const avgFromTurns = (key: string): number => {
    const vals = turns.map(t => {
      const ai = typeof t.ai_response === 'string' ? JSON.parse(t.ai_response) : t.ai_response as Record<string, any> | null;
      return ai?.[key];
    }).filter(v => v != null) as number[];
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

  const reportAvailableAt = new Date(reportAvailableAtStr);

  await db.update(speakingSessions)
    .set({
      status: 'completed',
      average_band: avgBand,
      report: JSON.stringify(finalReport),
      report_available_at: reportAvailableAt,
      report_unlocked: isPremium,
      ended_at: now,
    })
    .where(eq(speakingSessions.id, sessionId))
    .run();

  await env.CACHE.delete(`speaking:ctx:${sessionId}`);

  if (!isPremium) {
    await sendPushNotification(env.DB, userId, {
      title: '✅ Báo cáo Speaking đã sẵn sàng',
      body: `Báo cáo đánh giá của bạn đã được tổng hợp xong.`,
      data: { type: 'scoring_complete', session_id: sessionId },
    });
  }

  return finalReport;
}

export async function speakingConsumer(batch: MessageBatch<any>, env: Bindings, ctx: ExecutionContext) {
  for (const message of batch.messages) {
    try {
      const { sessionId, userId, isPremium, reportAvailableAtStr } = message.body;
      await processSpeakingReport(env, sessionId, userId, isPremium, reportAvailableAtStr);
      message.ack();
    } catch (err) {
      console.error('[Speaking Consumer] Message processing failed', err);
      message.retry();
    }
  }
}
