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
};

const app = new Hono<{ Bindings: Bindings }>({ strict: false });

// Middlewares
app.use('*', logger());

// B4: Restrict CORS to known origins instead of wildcard
app.use('*', cors({
  origin: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://ielts-platform.pages.dev', // update with your production domain
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
