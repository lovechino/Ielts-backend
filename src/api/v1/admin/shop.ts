import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { shopItems } from '../../../db/schema';
import { eq, desc, ne } from 'drizzle-orm';
import type { Bindings, Variables } from '../../../index';
import { adminGuard } from '../../../middleware/auth';
import { writeAdminAuditLog } from '../../../services/admin-audit.service';

const adminShopRouter = new Hono<{ Bindings: Bindings, Variables: Variables }>();
const ALLOWED_SHOP_ITEM_TYPES = new Set(['avatar', 'booster', 'protection', 'expansion']);

adminShopRouter.use('/*', adminGuard);

/**
 * GET /api/v1/admin/shop/items
 * Liệt kê tất cả vật phẩm (kể cả không active)
 */
adminShopRouter.get('/items', async (c) => {
  const db = drizzle(c.env.DB);
  try {
    const items = await db.select()
      .from(shopItems)
      .where(ne(shopItems.item_type, 'frame'))
      .orderBy(desc(shopItems.created_at));
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
    if (!ALLOWED_SHOP_ITEM_TYPES.has(body.item_type)) {
      return c.json({ success: false, error: 'Unsupported shop item type' }, 400);
    }

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
    await writeAdminAuditLog(c, 'shop_item.create', {
      targetType: 'shop_item',
      targetId: newItem.id,
      metadata: { name: newItem.name, item_type: newItem.item_type },
    });
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
    if (body.item_type !== undefined && !ALLOWED_SHOP_ITEM_TYPES.has(body.item_type)) {
      return c.json({ success: false, error: 'Unsupported shop item type' }, 400);
    }

    await db.update(shopItems)
      .set({
        ...body,
        created_at: undefined, // Không cho phép đổi ngày tạo
      })
      .where(eq(shopItems.id, id));

    await writeAdminAuditLog(c, 'shop_item.update', {
      targetType: 'shop_item',
      targetId: id,
      metadata: { fields: Object.keys(body) },
    });
    
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
    await writeAdminAuditLog(c, 'shop_item.delete', {
      targetType: 'shop_item',
      targetId: id,
    });
    return c.json({ success: true, message: 'Deleted successfully' });
  } catch (error) {
    return c.json({ success: false, error: 'Failed to delete item' }, 500);
  }
});

export default adminShopRouter;
