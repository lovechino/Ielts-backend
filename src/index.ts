import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

// V1 Routers
import apiRouter from './api/v1/router';

export type Bindings = {
  DB: D1Database;
  AI: any;
  MY_BUCKET: R2Bucket;
  CACHE: KVNamespace;
  JWT_SECRET: string;
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

export default app;
