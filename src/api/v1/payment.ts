import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { users, transactions, paymentWebhookEvents } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { jwtMiddleware } from '../../middleware/auth';
import type { Bindings, Variables } from '../../index';

const paymentRouter = new Hono<{ Bindings: Bindings, Variables: Variables }>();

const isPaymentMockEnabled = (c: any) => c.env.PAYMENT_MOCK_ENABLED === 'true';

/**
 * [MOCK PAYOS] - Tạo link thanh toán giả lập
 * POST /api/v1/payment/payos/create-link
 */
paymentRouter.post('/payos/create-link', jwtMiddleware, async (c) => {
  if (!isPaymentMockEnabled(c)) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }

  const userPayload = c.get('user') as any;
  const { amount, description } = await c.req.json();
  const db = drizzle(c.env.DB);

  if (!amount || amount < 1000) {
    return c.json({ success: false, error: 'Số tiền tối thiểu là 1,000đ' }, 400);
  }

  try {
    const orderCode = Math.floor(Date.now() / 1000); // Giả lập orderCode duy nhất
    const checkoutUrl = `https://mock-payos.ieltsapp.com/pay/${orderCode}`; // Link giả lập

    // Lưu transaction ở trạng thái pending
    await db.insert(transactions).values({
      id: crypto.randomUUID(),
      user_id: userPayload.id,
      amount: amount,
      currency: 'VND',
      type: 'topup',
      provider: 'payos',
      status: 'pending',
      metadata: { orderCode, description },
    });

    return c.json({
      success: true,
      data: {
        checkoutUrl,
        orderCode,
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * [MOCK PAYOS] - Webhook giả lập để confirm thanh toán
 * POST /api/v1/payment/payos/webhook
 */
paymentRouter.post('/payos/webhook', async (c) => {
  if (!isPaymentMockEnabled(c)) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }

  const body = await c.req.json();
  const { orderCode, status } = body; // Giả sử nhận từ simulator
  const db = drizzle(c.env.DB);

  if (!orderCode) return c.json({ success: false, error: 'Missing orderCode' }, 400);

  try {
    // 1. Tìm transaction tương ứng
    // Lưu ý: Trong SQLite, metadata là string, cần cẩn thận khi query hoặc fetch ra parse
    const allPending = await db.select().from(transactions)
      .where(eq(transactions.status, 'pending'))
      .all();
    
    const targetTx = allPending.find(tx => {
      const meta = typeof tx.metadata === 'string' ? JSON.parse(tx.metadata) : tx.metadata;
      return meta?.orderCode === orderCode;
    });

    if (!targetTx) return c.json({ success: false, error: 'Transaction not found' }, 404);

    if (status === 'PAID') {
      // Sử dụng db.batch() để thay thế db.transaction() nhằm tránh lỗi BEGIN TRANSACTION trên D1
      const [user] = await db.select().from(users).where(eq(users.id, targetTx.user_id)).limit(1);
      
      const gemsToAdd = Math.floor(targetTx.amount / 100);
      const batch = [];

      // Cập nhật trạng thái transaction
      batch.push(
        db.update(transactions)
          .set({ status: 'completed' })
          .where(eq(transactions.id, targetTx.id))
      );

      // Cộng Gems cho user
      if (user) {
        batch.push(
          db.update(users)
            .set({ 
              gems: (user.gems || 0) + gemsToAdd,
              updated_at: new Date()
            })
            .where(eq(users.id, user.id))
        );
      }

      await db.batch(batch as any);
      return c.json({ success: true, message: 'Payment confirmed and Gems added' });
    }

    return c.json({ success: true, message: 'Status updated' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * [MOCK PAYOS] - Simulator endpoint để user tự confirm (chỉ dành cho TEST)
 * POST /api/v1/payment/payos/simulate-success
 */
paymentRouter.post('/payos/simulate-success', jwtMiddleware, async (c) => {
  if (!isPaymentMockEnabled(c)) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }

  const { orderCode } = await c.req.json();
  // Gọi lại webhook nội bộ
  const baseUrl = new URL(c.req.url).origin;
  const res = await fetch(`${baseUrl}/api/v1/payment/payos/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderCode, status: 'PAID' }),
  });
  
  return c.json(await res.json());
});

/**
 * [REVENUECAT] - Webhook xử lý Apple/Google IAP
 * POST /api/v1/payment/webhook/revenuecat
 */
paymentRouter.post('/webhook/revenuecat', async (c) => {
  const authHeader = c.req.header('Authorization');
  const expectedAuth = c.env.REVENUECAT_WEBHOOK_AUTH_HEADER;

  if (!expectedAuth) {
    console.error('[RevenueCat] Webhook auth header is not configured');
    return c.json({ success: false, error: 'Webhook auth is not configured' }, 500);
  }

  // 1. Bảo mật: Kiểm tra Authorization Header
  if (authHeader !== `Bearer ${expectedAuth}`) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const { event } = body;

  if (!event || !['INITIAL_PURCHASE', 'RENEWAL'].includes(event.type)) {
    // Chúng ta chỉ quan tâm đến các sự kiện mua hàng thành công
    return c.json({ success: true, message: 'Event ignored' });
  }

  const userId = event.app_user_id;
  const productId = event.product_id; // Ví dụ: com.talko.app.gems_100
  const providerEventId = event.id || event.transaction_id;
  if (!providerEventId) {
    return c.json({ success: false, error: 'Missing event id' }, 400);
  }

  const db = drizzle(c.env.DB);

  try {
    // 2. Định nghĩa số lượng Gems dựa trên Product ID
    let gemsToAdd = 0;
    if (productId.includes('gems_100')) gemsToAdd = 100;
    else if (productId.includes('gems_500')) gemsToAdd = 500;
    else if (productId.includes('gems_1000')) gemsToAdd = 1000;
    else {
      // Nếu là sản phẩm không xác định, log lại và bỏ qua hoặc dùng metadata từ event
      console.warn(`[RevenueCat] Unknown product_id: ${productId}`);
      return c.json({ success: true, message: 'Unknown product' });
    }

    // 3. Update database
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      console.error(`[RevenueCat] User not found: ${userId}`);
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    const replayGuard = await db.insert(paymentWebhookEvents).values({
      id: crypto.randomUUID(),
      provider: 'revenuecat',
      provider_event_id: providerEventId,
      user_id: userId,
      event_type: event.type,
      metadata: {
        product_id: productId,
        transaction_id: event.transaction_id,
      },
    }).onConflictDoNothing({ target: paymentWebhookEvents.provider_event_id }).run();

    if (replayGuard.meta.changes === 0) {
      console.warn(`[RevenueCat] Duplicate event ignored: ${providerEventId}`);
      return c.json({ success: true, message: 'Duplicate event ignored' });
    }

    const batch = [];
    
    // Lưu lịch sử transaction
    batch.push(
      db.insert(transactions).values({
        id: crypto.randomUUID(),
        user_id: userId,
        amount: gemsToAdd,
        currency: 'GEMS', // RevenueCat logic dùng Gems làm đơn vị chính ở đây
        type: 'topup',
        provider: 'revenuecat',
        status: 'completed',
        metadata: { 
          event_id: event.id, 
          product_id: productId, 
          transaction_id: event.transaction_id 
        },
      })
    );

    // Cộng Gems cho user
    batch.push(
      db.update(users)
        .set({ 
          gems: (user.gems || 0) + gemsToAdd,
          updated_at: new Date()
        })
        .where(eq(users.id, userId))
    );

    await db.batch(batch as any);
    console.log(`[RevenueCat] Success: Added ${gemsToAdd} gems to user ${userId}`);

    return c.json({ success: true, message: 'Webhook processed' });
  } catch (error: any) {
    console.error(`[RevenueCat] Webhook error: ${error.message}`);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default paymentRouter;
