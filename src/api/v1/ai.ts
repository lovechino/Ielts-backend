import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import type { Bindings } from '../../index';

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

  try {
    // 1. Chuyển base64 sang Uint8Array
    const binaryString = atob(audio);
    const audioBuffer = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      audioBuffer[i] = binaryString.charCodeAt(i);
    }

    // 2. Sử dụng Cloudflare Workers AI Whisper
    // Whisper model trên CF Workers AI yêu cầu input là một array buffer hoặc stream
    const response = await c.env.AI.run('@cf/openai/whisper', {
      audio: [...audioBuffer] // Vẫn cần array cho fetch wrapper của AI.run hiện tại
    });

    const transcription = response.text?.trim()?.toLowerCase() || '';
    const cleanTarget = target_text.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
    const cleanHeard = transcription.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");

    // 3. Tính toán độ chính xác (Levenshtein simple)
    const accuracy = calculateAccuracy(cleanTarget, cleanHeard);

    return c.json({
      success: true,
      data: {
        transcription: cleanHeard,
        target_text: cleanTarget,
        accuracy,
        status: accuracy >= 0.8 ? 'excellent' : accuracy >= 0.5 ? 'good' : 'try_again'
      }
    });
  } catch (error: any) {
    console.error('AI Pronunciation Error:', error);
    return c.json({ success: false, message: 'AI processing failed', error: error.message }, 500);
  }
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
