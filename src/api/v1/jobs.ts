// Jobs route moved to admin/jobs.ts — admin-only with role check
import { Hono } from 'hono';
import type { Bindings } from '../../index';

const jobRouter = new Hono<{ Bindings: Bindings }>();
// No public job endpoints — admin only via /api/v1/admin/jobs/:id

export default jobRouter;
