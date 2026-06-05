import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { users, transactions } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { jwtMiddleware } from '../../middleware/auth';
import type { Bindings, Variables } from '../../index';

const paymentRouter = new Hono<{ Bindings: Bindings, Variables: Variables }>();

/**
 * [MOCK PAYOS] - Tạo link thanh toán giả lập
 * POST /api/v1/payment/payos/create-link
 */
paymentRouter.post('/payos/create-link', jwtMiddleware, async (c) => {
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
      await db.transaction(async (tx) => {
        // Cập nhật trạng thái transaction
        await tx.update(transactions)
          .set({ status: 'completed' })
          .where(eq(transactions.id, targetTx.id));

        // Cộng Gems cho user (Ví dụ: 1,000đ = 10 Gems)
        const gemsToAdd = Math.floor(targetTx.amount / 100); 
        
        const [user] = await tx.select().from(users).where(eq(users.id, targetTx.user_id)).limit(1);
        if (user) {
          await tx.update(users)
            .set({ 
              gems: (user.gems || 0) + gemsToAdd,
              updated_at: new Date()
            })
            .where(eq(users.id, user.id));
        }
      });
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

export default paymentRouter;
