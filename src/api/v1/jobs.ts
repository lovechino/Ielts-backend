import { Hono } from 'hono';
import { JobService } from '../../services/job.service';
import type { Bindings } from '../../index';

const jobRouter = new Hono<{ Bindings: Bindings }>();

// GET /api/v1/jobs/:id
jobRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const service = new JobService(c.env.CACHE); // Use CACHE KV for jobs
  
  const job = await service.get(id);
  if (!job) {
    return c.json({ success: false, error: 'Job not found' }, 404);
  }

  return c.json({ success: true, data: job });
});

export default jobRouter;
