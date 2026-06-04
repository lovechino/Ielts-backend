import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { shopItems, userInventory, users } from '../../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { jwtMiddleware } from '../../middleware/auth';
import type { Bindings } from '../../index';

const shopRouter = new Hono<{ Bindings: Bindings }>();

// Tất cả các routes yêu cầu đăng nhập
shopRouter.use('*', jwtMiddleware);

/**
 * GET /api/v1/shop/items
 * Liệt kê danh sách vật phẩm đang mở bán
 */
shopRouter.get('/items', async (c) => {
  const db = drizzle(c.env.DB);
  try {
    const items = await db.select().from(shopItems).where(eq(shopItems.is_active, true));
    return c.json({ success: true, data: items });
  } catch (error) {
    return c.json({ success: false, error: 'Failed to fetch shop items' }, 500);
  }
});

/**
 * GET /api/v1/shop/inventory
 * Lấy danh sách vật phẩm user đang sở hữu
 */
shopRouter.get('/inventory', async (c) => {
  const user = c.get('user') as any;
  const db = drizzle(c.env.DB);
  try {
    const inventory = await db
      .select({
        inventory_id: userInventory.id,
        item_id: shopItems.id,
        name: shopItems.name,
        item_type: shopItems.item_type,
        sub_type: shopItems.sub_type,
        rarity: shopItems.rarity,
        image_url: shopItems.image_url,
        quantity: userInventory.quantity,
        is_equipped: userInventory.is_equipped,
        expires_at: userInventory.expires_at,
        metadata: shopItems.metadata,
      })
      .from(userInventory)
      .innerJoin(shopItems, eq(userInventory.item_id, shopItems.id))
      .where(eq(userInventory.user_id, user.id));

    return c.json({ success: true, data: inventory });
  } catch (error) {
    return c.json({ success: false, error: 'Failed to fetch inventory' }, 500);
  }
});

/**
 * POST /api/v1/shop/buy
 * Mua vật phẩm
 */
shopRouter.post('/buy', async (c) => {
  const userPayload = c.get('user') as any;
  const { itemId, quantity = 1 } = await c.req.json();
  const db = drizzle(c.env.DB);

  try {
    // 1. Lấy thông tin vật phẩm và user
    const [item] = await db.select().from(shopItems).where(eq(shopItems.id, itemId)).limit(1);
    const [userData] = await db.select().from(users).where(eq(users.id, userPayload.id)).limit(1);

    if (!item) return c.json({ success: false, error: 'Item not found' }, 404);
    if (!item.is_active) return c.json({ success: false, error: 'Item is not for sale' }, 400);

    const totalPriceCoins = (item.price_coins || 0) * quantity;
    const totalPriceGems = (item.price_gems || 0) * quantity;

    // 2. Kiểm tra số dư
    if (userData.coins < totalPriceCoins || userData.gems < totalPriceGems) {
      return c.json({ success: false, error: 'Insufficient balance' }, 400);
    }

    // 3. Thực hiện giao dịch (Atomic)
    await db.transaction(async (tx) => {
      // Trừ tiền
      await tx.update(users)
        .set({ 
          coins: userData.coins - totalPriceCoins,
          gems: userData.gems - totalPriceGems,
          updated_at: new Date()
        })
        .where(eq(users.id, userData.id));

      // Thêm vào kho đồ (Nếu đã có thì tăng số lượng)
      const [existing] = await tx.select()
        .from(userInventory)
        .where(and(eq(userInventory.user_id, userData.id), eq(userInventory.item_id, itemId)))
        .limit(1);

      if (existing && (item.item_type === 'booster' || item.item_type === 'protection')) {
        await tx.update(userInventory)
          .set({ quantity: existing.quantity + quantity, updated_at: new Date() })
          .where(eq(userInventory.id, existing.id));
      } else {
        await tx.insert(userInventory).values({
          user_id: userData.id,
          item_id: itemId,
          quantity: quantity,
          is_equipped: false,
        });
      }
    });

    return c.json({ success: true, message: 'Purchase successful' });
  } catch (error) {
    console.error('Buy error:', error);
    return c.json({ success: false, error: 'Transaction failed' }, 500);
  }
});

/**
 * POST /api/v1/shop/equip
 * Trang bị vật phẩm (Avatar/Frame)
 */
shopRouter.post('/equip', async (c) => {
  const user = c.get('user') as any;
  const { inventoryId } = await c.req.json();
  const db = drizzle(c.env.DB);

  try {
    const [invItem] = await db
      .select({
        type: shopItems.item_type,
        url: shopItems.image_url,
        itemId: shopItems.id,
      })
      .from(userInventory)
      .innerJoin(shopItems, eq(userInventory.item_id, shopItems.id))
      .where(and(eq(userInventory.id, inventoryId), eq(userInventory.user_id, user.id)))
      .limit(1);

    if (!invItem) return c.json({ success: false, error: 'Item not owned' }, 404);

    await db.transaction(async (tx) => {
      // 1. Tháo tất cả vật phẩm cùng loại hiện tại (Nếu là avatar/frame/booster)
      if (invItem.type === 'avatar' || invItem.type === 'frame' || invItem.type === 'booster') {
        const sameTypeItems = db
          .select({ id: userInventory.id })
          .from(userInventory)
          .innerJoin(shopItems, eq(userInventory.item_id, shopItems.id))
          .where(and(eq(userInventory.user_id, user.id), eq(shopItems.item_type, invItem.type)));
        
        await tx.update(userInventory)
          .set({ is_equipped: false })
          .where(sql`${userInventory.id} IN ${sameTypeItems}`);
      }

      // 2. Trang bị vật phẩm mới & Thiết lập ngày hết hạn nếu là Booster
      let expiresAt = null;
      if (invItem.type === 'booster') {
        const metadata = invItem.metadata as any;
        const durationHours = metadata?.duration_hours || 24;
        expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
      }

      await tx.update(userInventory)
        .set({ 
          is_equipped: true, 
          expires_at: expiresAt,
          updated_at: new Date() 
        })
        .where(eq(userInventory.id, inventoryId));

      // 3. Cập nhật profile user
      if (invItem.type === 'avatar') {
        await tx.update(users).set({ avatar_url: invItem.url }).where(eq(users.id, user.id));
      } else if (invItem.type === 'frame') {
        await tx.update(users).set({ avatar_frame: invItem.url }).where(eq(users.id, user.id));
      }
    });

    return c.json({ success: true, message: 'Equipped successfully' });
  } catch (error) {
    return c.json({ success: false, error: 'Failed to equip item' }, 500);
  }
});

export default shopRouter;
