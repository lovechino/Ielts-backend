import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users } from '../../../db/schema';
import { JobService } from '../../../services/job.service';
import type { Bindings } from '../../../index';

const adminJobRouter = new Hono<{ Bindings: Bindings }>();

adminJobRouter.use('/*', async (c, next) => {
  if (c.env.ENABLE_ADMIN !== 'true') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  return next();
});

adminJobRouter.use('/*', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  const jwtMiddleware = jwt({ secret, alg: 'HS256' });
  return jwtMiddleware(c, next);
});

adminJobRouter.use('/*', async (c, next) => {
  const payload = c.get('jwtPayload') as { sub: string; role?: string };
  if (payload.role !== 'admin') {
    const db = drizzle(c.env.DB);
    const user = await db.select({ role: users.role }).from(users).where(eq(users.id, payload.sub)).get();
    if (user?.role !== 'admin') {
      return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
    }
  }
  return next();
});

adminJobRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const service = new JobService(c.env.CACHE);
  const job = await service.get(id);
  if (!job) {
    return c.json({ success: false, error: 'Job not found' }, 404);
  }
  return c.json({ success: true, data: job });
});

export default adminJobRouter;
