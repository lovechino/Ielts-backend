import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users } from '../../../db/schema';
import type { Bindings } from '../../../index';

const adminUploadRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

adminUploadRouter.use('/*', async (c, next) => {
  if (c.env.ENABLE_ADMIN !== 'true') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  return next();
});

adminUploadRouter.use('/*', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  const jwtMiddleware = jwt({ secret, alg: 'HS256' });
  return jwtMiddleware(c, next);
});

adminUploadRouter.use('/*', async (c, next) => {
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

adminUploadRouter.post('/', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as any;

  if (!file || typeof file === 'string') {
    return c.json({ success: false, error: { message: 'No file provided' } }, 400);
  }

  const ext = file.name.split('.').pop();
  const uniqueFilename = `${crypto.randomUUID()}.${ext}`;

  try {
    await c.env.MY_BUCKET.put(uniqueFilename, await (file as any).arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });

    const origin = new URL(c.req.url).origin;
    const fileUrl = `${origin}/api/v1/upload/files/${uniqueFilename}`;

    return c.json({
      success: true,
      url: fileUrl,
      filename: file.name
    });
  } catch (e: any) {
    return c.json({ success: false, error: { message: `Upload failed: ${e.message}` } }, 500);
  }
});

export default adminUploadRouter;
