import { jwt } from 'hono/jwt';
import type { Context, Next } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import type { Bindings, Variables } from '../index';

export function requireJwtSecret(c: { env: Bindings }): string {
  const secret = c.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return secret;
}

/**
 * Middleware xác thực JWT cho các route yêu cầu đăng nhập.
 * Sau khi qua middleware này, payload sẽ có trong c.get('jwtPayload').
 * Ngoài ra còn inject 'user' vào context để dễ truy cập.
 */
export const jwtMiddleware = async (c: Context<{ Bindings: Bindings, Variables: Variables }>, next: Next) => {
  let secret: string;
  try {
    secret = requireJwtSecret(c);
  } catch {
    return c.json({ success: false, error: 'Server auth is not configured' }, 500);
  }
  
  // 1. Chạy Hono JWT middleware chuẩn
  const middleware = jwt({ secret, alg: 'HS256' });
  await middleware(c, async () => {
    // 2. Nếu pass, inject user shorthand vào context
    const payload = c.get('jwtPayload') as any;
    if (payload && payload.sub) {
      c.set('user', {
        id: payload.sub,
        email: payload.email,
        role: payload.role
      });
    }
    await next();
  });
};

export const adminGuard = async (c: Context<{ Bindings: Bindings, Variables: Variables }>, next: Next) => {
  if (c.env.ENABLE_ADMIN !== 'true') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }

  let secret: string;
  try {
    secret = requireJwtSecret(c);
  } catch {
    return c.json({ success: false, error: 'Server auth is not configured' }, 500);
  }

  const authResult = await jwt({ secret, alg: 'HS256' })(c, async () => {});
  if (authResult) return authResult;

  const payload = c.get('jwtPayload') as { sub: string; role?: string };
  if (!payload?.sub) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  if (payload.role === 'admin') {
    return next();
  }

  const db = drizzle(c.env.DB);
  const user = await db.select({ role: users.role }).from(users).where(eq(users.id, payload.sub)).get();
  if (user?.role !== 'admin') {
    return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
  }

  return next();
};
