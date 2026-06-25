import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { ScheduledEvent, ExecutionContext, Queue, MessageBatch } from '@cloudflare/workers-types';
import { generalRateLimit } from './middleware/rateLimit';

// V1 Routers
import apiRouter from './api/v1/router';

export type Bindings = {
  DB: D1Database;
  AI: any;
  MY_BUCKET: R2Bucket;
  CACHE: KVNamespace;
  JWT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_ANDROID_CLIENT_ID?: string;
  GOOGLE_IOS_CLIENT_ID?: string;
  FRONTEND_URL: string;
  RESEND_API_KEY?: string;
  REVENUECAT_WEBHOOK_AUTH_HEADER?: string;
  REVENUECAT_API_KEY?: string;
  ENABLE_ADMIN?: string;
  ENABLE_PROMOTE_ADMIN?: string;
  DICTIONARY_TARGET_WORDS?: string;
  PAYMENT_MOCK_ENABLED?: string;
  ALLOWED_ORIGINS?: string;
  /** Secret key để promote user thành admin. Không set = tính năng bị khoá. */
  ADMIN_SECRET?: string;
  SCORING_QUEUE: Queue;
  SPEAKING_QUEUE: Queue;
  EMAIL_QUEUE: Queue;
};

export type Variables = {
  jwtPayload: any;
  user: {
    id: string;
    email: string;
    role: string;
  };
};

const app = new Hono<{ Bindings: Bindings, Variables: Variables }>({ strict: false });

// Middlewares
app.use('*', logger());

// CORS: web clients only (Expo native does not send preflight).
app.use('*', cors({
  origin: (origin, c) => {
    const configuredOrigins = c.env.ALLOWED_ORIGINS
      ?.split(',')
      .map((item: string) => item.trim())
      .filter(Boolean);
    const allowed = configuredOrigins?.length ? configuredOrigins : [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:8081',
      'http://127.0.0.1:8081',
      'http://localhost:19006',
      'http://127.0.0.1:19006',
      'https://ielts-platform.pages.dev',
    ];
    if (!origin) return undefined;
    if (allowed.includes(origin)) return origin;
    // Local dev: Expo web / other localhost ports. Disabled once ALLOWED_ORIGINS is configured.
    if (!configuredOrigins?.length && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
    return undefined;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

// Health Check
app.get('/', (c) => {
  return c.json({ message: 'Welcome to Talko API (Cloudflare Edge)' });
});

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    version: '1.0.0',
    project: 'Talko AI-Powered IELTS Platform'
  });
});

// Global rate limit cho toàn bộ /api/v1 — phải đăng ký TRƯỚC route để Hono áp dụng đúng
app.use('/api/v1/*', generalRateLimit);

app.route('/api/v1', apiRouter);

// Cron: daily streak reset at 0h UTC
export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext) => {
    if (event.cron === '0 0 * * *') {
      const { StreakService } = await import('./services/streak.service');
      const service = new StreakService(env.DB);
      const resetCount = await service.batchResetStaleStreaks();
      console.log(`[Cron] Streak reset: ${resetCount} users`);
    } else if (event.cron === '0 9 * * 1') {
      // Weekly report
      if (env.EMAIL_QUEUE) {
        const { getWeeklyReportData } = await import('./services/email.service');
        const reportTasks = await getWeeklyReportData(env.DB);
        for (const task of reportTasks) {
          await env.EMAIL_QUEUE.send(task);
        }
        console.log(`[Cron] Enqueued ${reportTasks.length} weekly reports`);
      }
    }
  },
  queue: async (batch: MessageBatch<any>, env: Bindings, ctx: ExecutionContext) => {
    switch (batch.queue) {
      case 'scoring-queue': {
        // Vocab contribution review messages are routed through scoring-queue
        const hasContribMessages = batch.messages.some(m => m.body?.type === 'vocab_contribution_review');
        const hasScoringMessages = batch.messages.some(m => !m.body?.type);

        if (hasContribMessages) {
          const { vocabContributionConsumer } = await import('./workers/vocab-contribution-consumer');
          const contribBatch = { ...batch, messages: batch.messages.filter(m => m.body?.type === 'vocab_contribution_review') };
          await vocabContributionConsumer(contribBatch as any, env, ctx);
        }
        if (hasScoringMessages) {
          const { scoringConsumer } = await import('./workers/scoring-consumer');
          const scoringBatch = { ...batch, messages: batch.messages.filter(m => !m.body?.type) };
          await scoringConsumer(scoringBatch as any, env, ctx);
        }
        break;
      }
      case 'speaking-queue': {
        const { speakingConsumer } = await import('./workers/speaking-consumer');
        await speakingConsumer(batch, env, ctx);
        break;
      }
      case 'email-queue': {
        const { emailConsumer } = await import('./workers/email-consumer');
        await emailConsumer(batch, env, ctx);
        break;
      }
      default:
        console.warn(`[Queue] Unknown queue: ${batch.queue}`);
    }
  },
};
