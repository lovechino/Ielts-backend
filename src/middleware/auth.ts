import { jwt } from 'hono/jwt';
import type { Context, Next } from 'hono';
import type { Bindings, Variables } from '../index';

/**
 * Middleware xác thực JWT cho các route yêu cầu đăng nhập.
 * Sau khi qua middleware này, payload sẽ có trong c.get('jwtPayload').
 * Ngoài ra còn inject 'user' vào context để dễ truy cập.
 */
export const jwtMiddleware = async (c: Context<{ Bindings: Bindings, Variables: Variables }>, next: Next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  
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
