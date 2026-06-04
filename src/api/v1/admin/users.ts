import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { users } from '../../../db/schema';
import { eq, like, or, and, sql, desc } from 'drizzle-orm';
import type { Bindings } from '../../../index';

const adminUserRouter = new Hono<{ Bindings: Bindings }>();

adminUserRouter.use('/*', async (c, next) => {
  if (c.env.ENABLE_ADMIN !== 'true') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  return next();
});

adminUserRouter.use('/*', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  return jwt({ secret, alg: 'HS256' })(c, next);
});

adminUserRouter.use('/*', async (c, next) => {
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

/**
 * GET /api/v1/admin/users
 * Liệt kê và tìm kiếm user
 */
adminUserRouter.get('/', async (c) => {
  const { role, tier, query, limit = '50', offset = '0' } = c.req.query();
  const db = drizzle(c.env.DB);
  
  try {
    let whereClause: any = undefined;
    const conditions = [];

    if (role) conditions.push(eq(users.role, role));
    if (tier) conditions.push(eq(users.tier, tier));
    if (query) {
      conditions.push(or(
        like(users.email, `%${query}%`),
        like(users.full_name, `%${query}%`)
      ));
    }

    if (conditions.length > 0) {
      whereClause = and(...conditions);
    }

    const data = await db.select({
      id: users.id,
      email: users.email,
      full_name: users.full_name,
      role: users.role,
      tier: users.tier,
      current_streak: users.current_streak,
      coins: users.coins,
      gems: users.gems,
      xp: users.xp,
      last_active_date: users.last_active_date,
      created_at: users.created_at,
    })
    .from(users)
    .where(whereClause)
    .limit(parseInt(limit))
    .offset(parseInt(offset))
    .orderBy(desc(users.created_at));

    return c.json({ success: true, data });
  } catch (error) {
    return c.json({ success: false, error: 'Failed to fetch users' }, 500);
  }
});

/**
 * PATCH /api/v1/admin/users/:id
 * Cập nhật thông tin user (streak, coins, gems, role, tier)
 */
adminUserRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const db = drizzle(c.env.DB);
  try {
    const body = await c.req.json();
    
    // Bảo vệ các trường không được phép sửa đổi trực tiếp qua đây nếu cần
    const allowedUpdates = [
      'role', 'tier', 'current_streak', 'longest_streak', 
      'coins', 'gems', 'xp', 'level', 'is_active'
    ];
    
    const updateData: any = {};
    for (const key of allowedUpdates) {
      if (body[key] !== undefined) {
        updateData[key] = body[key];
      }
    }

    updateData.updated_at = new Date();

    await db.update(users)
      .set(updateData)
      .where(eq(users.id, id));

    return c.json({ success: true, message: 'User updated successfully' });
  } catch (error) {
    return c.json({ success: false, error: 'Failed to update user' }, 500);
  }
});

export default adminUserRouter;
