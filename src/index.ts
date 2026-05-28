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
  FRONTEND_URL: string;
  RESEND_API_KEY?: string;
  ENABLE_ADMIN?: string;
  SCORING_QUEUE: Queue;
  SPEAKING_QUEUE: Queue;
  EMAIL_QUEUE: Queue;
};

const app = new Hono<{ Bindings: Bindings }>({ strict: false });

// Middlewares
app.use('*', logger());

// CORS: web clients only (Expo native does not send preflight).
app.use('*', cors({
  origin: (origin) => {
    const allowed = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:8081',
      'http://127.0.0.1:8081',
      'http://localhost:19006',
      'http://127.0.0.1:19006',
      'https://ielts-platform.pages.dev',
    ];
    if (!origin) return 'http://localhost:3000';
    if (allowed.includes(origin)) return origin;
    // Local dev: Expo web / other localhost ports
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
    return 'http://localhost:3000';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

// Health Check
app.get('/', (c) => {
  return c.json({ message: 'Welcome to IELTS Learning Platform API (Cloudflare Edge)' });
});

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    version: '1.0.0',
    project: 'IELTS Learning Platform CF'
  });
});

app.route('/api/v1', apiRouter);

// Global rate limit cho toàn bộ /api/v1 — chặn abuse rõ ràng
app.use('/api/v1/*', generalRateLimit);

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
        const { scoringConsumer } = await import('./workers/scoring-consumer');
        await scoringConsumer(batch, env, ctx);
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
