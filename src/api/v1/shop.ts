import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { shopItems, userInventory, users } from '../../db/schema';
import { eq, and, sql, ne } from 'drizzle-orm';
import { jwtMiddleware } from '../../middleware/auth';
import type { Bindings, Variables } from '../../index';

const shopRouter = new Hono<{ Bindings: Bindings, Variables: Variables }>();
const REMOVED_ITEM_TYPES = ['frame'];

// Tất cả các routes yêu cầu đăng nhập
shopRouter.use('*', jwtMiddleware);

/**
 * GET /api/v1/shop/items
 * Liệt kê danh sách vật phẩm đang mở bán
 */
shopRouter.get('/items', async (c) => {
  const db = drizzle(c.env.DB);
  try {
    const items = await db.select().from(shopItems).where(and(
      eq(shopItems.is_active, true),
      ne(shopItems.item_type, 'frame')
    ));
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
      .where(and(eq(userInventory.user_id, user.id), ne(shopItems.item_type, 'frame')));

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
    if (REMOVED_ITEM_TYPES.includes(item.item_type)) {
      return c.json({ success: false, error: 'Item type is no longer supported' }, 400);
    }
    if (!item.is_active) return c.json({ success: false, error: 'Item is not for sale' }, 400);

    const totalPriceCoins = (item.price_coins || 0) * quantity;
    const totalPriceGems = (item.price_gems || 0) * quantity;

    // 2. Kiểm tra số dư
    if ((userData.coins ?? 0) < totalPriceCoins || (userData.gems ?? 0) < totalPriceGems) {
      return c.json({ success: false, error: 'Insufficient balance' }, 400);
    }

    // 3. Thực hiện giao dịch (Atomic) — dùng sql arithmetic để tránh TOCTOU race condition
    const [existing] = await db.select()
      .from(userInventory)
      .where(and(eq(userInventory.user_id, userData.id), eq(userInventory.item_id, itemId)))
      .limit(1);

    // Cập nhật coins/gems bằng phép trừ SQL (atomic), check không âm để phòng race condition
    const updateMoney = db.update(users)
      .set({ 
        coins: sql`MAX(0, ${users.coins} - ${totalPriceCoins})`,
        gems: sql`MAX(0, ${users.gems} - ${totalPriceGems})`,
        updated_at: new Date()
      })
      .where(and(
        eq(users.id, userData.id),
        sql`${users.coins} >= ${totalPriceCoins}`,
        sql`${users.gems} >= ${totalPriceGems}`
      ));

    if (existing && (item.item_type === 'booster' || item.item_type === 'protection' || item.item_type === 'expansion')) {
      const updateInv = db.update(userInventory)
        .set({ quantity: existing.quantity + quantity, updated_at: new Date() })
        .where(eq(userInventory.id, existing.id));
      
      await db.batch([updateMoney, updateInv]);
    } else {
      const insertInv = db.insert(userInventory).values({
        user_id: userData.id,
        item_id: itemId,
        quantity: quantity,
        is_equipped: false,
      });

      await db.batch([updateMoney, insertInv]);
    }

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
       inventory_id: userInventory.id,
       is_equipped: userInventory.is_equipped,
       type: shopItems.item_type,
       url: shopItems.image_url,
       itemId: shopItems.id,
       metadata: shopItems.metadata,
     })
     .from(userInventory)
     .innerJoin(shopItems, eq(userInventory.item_id, shopItems.id))
     .where(and(eq(userInventory.id, inventoryId), eq(userInventory.user_id, user.id)))
     .limit(1);

   if (!invItem) return c.json({ success: false, error: 'Item not owned' }, 404);
   if (REMOVED_ITEM_TYPES.includes(invItem.type)) {
     return c.json({ success: false, error: 'Item type is no longer supported' }, 400);
   }

   const isUnequipping = invItem.is_equipped;
   const batch = [];

   // 1. Nếu đang trang bị (Equipping) -> Tháo tất cả vật phẩm cùng loại hiện tại
   if (!isUnequipping && (invItem.type === 'avatar' || invItem.type === 'booster')) {
     const sameTypeItems = db
       .select({ id: userInventory.id })
       .from(userInventory)
       .innerJoin(shopItems, eq(userInventory.item_id, shopItems.id))
       .where(and(eq(userInventory.user_id, user.id), eq(shopItems.item_type, invItem.type)));

     batch.push(
       db.update(userInventory)
         .set({ is_equipped: false })
         .where(sql`${userInventory.id} IN ${sameTypeItems}`)
     );
   }

   // 2. Cập nhật trạng thái của vật phẩm mục tiêu (Toggle)
   let expiresAt = null;
   if (!isUnequipping && invItem.type === 'booster') {
     const metadata = invItem.metadata as any;
     const durationHours = metadata?.duration_hours || 24;
     expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
   }

   batch.push(
     db.update(userInventory)
       .set({ 
         is_equipped: !isUnequipping, 
         expires_at: expiresAt,
         updated_at: new Date() 
       })
       .where(eq(userInventory.id, inventoryId))
   );

   // 3. Cập nhật profile user
   if (invItem.type === 'avatar') {
     batch.push(db.update(users).set({ avatar_url: isUnequipping ? null : invItem.url }).where(eq(users.id, user.id)));
   }

   if (batch.length > 0) {
     await db.batch(batch as any);
   }

   return c.json({ 
     success: true, 
     message: isUnequipping ? 'Unequipped successfully' : 'Equipped successfully',
     is_equipped: !isUnequipping 
   });
 } catch (error) {
   console.error('Equip error:', error);
   return c.json({ success: false, error: 'Failed to toggle item' }, 500);
 }
});

export default shopRouter;
