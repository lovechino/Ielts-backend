import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { shopItems, users } from '../../../db/schema';
import { eq, desc } from 'drizzle-orm';
import type { Bindings } from '../../../index';

const adminShopRouter = new Hono<{ Bindings: Bindings }>();

adminShopRouter.use('/*', async (c, next) => {
  if (c.env.ENABLE_ADMIN !== 'true') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  return next();
});

adminShopRouter.use('/*', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  return jwt({ secret, alg: 'HS256' })(c, next);
});

adminShopRouter.use('/*', async (c, next) => {
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
 * GET /api/v1/admin/shop/items
 * Liệt kê tất cả vật phẩm (kể cả không active)
 */
adminShopRouter.get('/items', async (c) => {
  const db = drizzle(c.env.DB);
  try {
    const items = await db.select().from(shopItems).orderBy(desc(shopItems.created_at));
    return c.json({ success: true, data: items });
  } catch (error) {
    return c.json({ success: false, error: 'Failed to fetch items' }, 500);
  }
});

/**
 * POST /api/v1/admin/shop/items
 * Tạo vật phẩm mới
 */
adminShopRouter.post('/items', async (c) => {
  const db = drizzle(c.env.DB);
  try {
    const body = await c.req.json();
    const newItem = {
      id: crypto.randomUUID(),
      name: body.name,
      description: body.description,
      item_type: body.item_type,
      sub_type: body.sub_type || 'static',
      rarity: body.rarity || 'common',
      price_coins: body.price_coins || 0,
      price_gems: body.price_gems || 0,
      image_url: body.image_url,
      metadata: body.metadata || {},
      is_active: body.is_active ?? true,
      created_at: new Date(),
    };

    await db.insert(shopItems).values(newItem);
    return c.json({ success: true, data: newItem });
  } catch (error) {
    return c.json({ success: false, error: 'Failed to create item' }, 500);
  }
});

/**
 * PATCH /api/v1/admin/shop/items/:id
 * Cập nhật vật phẩm
 */
adminShopRouter.patch('/items/:id', async (c) => {
  const id = c.req.param('id');
  const db = drizzle(c.env.DB);
  try {
    const body = await c.req.json();
    await db.update(shopItems)
      .set({
        ...body,
        created_at: undefined, // Không cho phép đổi ngày tạo
      })
      .where(eq(shopItems.id, id));
    
    return c.json({ success: true, message: 'Updated successfully' });
  } catch (error) {
    return c.json({ success: false, error: 'Failed to update item' }, 500);
  }
});

/**
 * DELETE /api/v1/admin/shop/items/:id
 * Xóa vật phẩm
 */
adminShopRouter.delete('/items/:id', async (c) => {
  const id = c.req.param('id');
  const db = drizzle(c.env.DB);
  try {
    await db.delete(shopItems).where(eq(shopItems.id, id));
    return c.json({ success: true, message: 'Deleted successfully' });
  } catch (error) {
    return c.json({ success: false, error: 'Failed to delete item' }, 500);
  }
});

export default adminShopRouter;
