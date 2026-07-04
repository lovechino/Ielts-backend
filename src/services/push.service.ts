import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { devicePushTokens } from '../db/schema';
import type { D1Database } from '@cloudflare/workers-types';

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
}

/**
 * Gửi Expo push notification đến tất cả thiết bị của user.
 * Dùng Expo Push API — không cần AdMob hay APNs/FCM trực tiếp.
 */
export async function sendPushNotification(
  d1: D1Database,
  userId: string,
  payload: PushPayload
): Promise<void> {
  const db = drizzle(d1);

  const tokens = await db
    .select({ expo_push_token: devicePushTokens.expo_push_token })
    .from(devicePushTokens)
    .where(eq(devicePushTokens.user_id, userId))
    .all();

  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.expo_push_token,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: 'default',
    priority: 'high',
  }));

  // Expo Push API nhận tối đa 100 messages/request — batch nếu cần
  const EXPO_BATCH_SIZE = 100;
  try {
    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(batch),
      });
    }
  } catch (err) {
    // Push notification là best-effort — không throw để không ảnh hưởng flow chính
    console.error('[push] Failed to send notification:', err);
  }
}
