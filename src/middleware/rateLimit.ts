import type { Context, Next } from 'hono';
import type { Bindings } from '../index';

interface RateLimitOptions {
  /** Số request tối đa trong window */
  limit: number;
  /** Độ dài window tính bằng giây */
  windowSecs: number;
  /** Prefix cho KV key — dùng để phân biệt các rule khác nhau */
  keyPrefix: string;
  /**
   * Cách lấy identifier từ request.
   * - 'ip'   : dùng CF-Connecting-IP (default)
   * - 'user' : dùng JWT sub (cần đã qua jwt middleware)
   * - fn     : custom extractor
   */
  identifier?: 'ip' | 'user' | ((c: Context) => string | null);
}

/**
 * Sliding window rate limiter dùng Cloudflare KV.
 *
 * KV key format: `rl:{keyPrefix}:{identifier}`
 * Value: JSON array of timestamps (Unix ms) trong window hiện tại.
 *
 * Lưu ý: KV có độ trễ eventual consistency ~1s — đủ tốt cho rate limiting
 * chống abuse, không phải exact counter.
 */
export function rateLimit(opts: RateLimitOptions) {
  return async (c: Context<{ Bindings: Bindings }>, next: Next) => {
    const cache = c.env.CACHE;
    if (!cache) return next(); // Nếu không có KV binding thì bỏ qua

    // 1. Lấy identifier
    let id: string | null = null;

    if (typeof opts.identifier === 'function') {
      id = opts.identifier(c);
    } else if (opts.identifier === 'user') {
      const payload = c.get('jwtPayload') as any;
      id = payload?.sub ?? null;
    } else {
      // 'ip' (default) — Cloudflare cung cấp qua header
      id =
        c.req.header('CF-Connecting-IP') ||
        c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
        'unknown';
    }

    if (!id) return next(); // Không xác định được identifier → bỏ qua

    const kvKey = `rl:${opts.keyPrefix}:${id}`;
    const now = Date.now();
    const windowMs = opts.windowSecs * 1000;
    const cutoff = now - windowMs;

    // 2. Đọc timestamps hiện tại từ KV
    let timestamps: number[] = [];
    try {
      const raw = await cache.get(kvKey);
      if (raw) timestamps = JSON.parse(raw);
    } catch {
      timestamps = [];
    }

    // 3. Lọc bỏ timestamps ngoài window
    timestamps = timestamps.filter((t) => t > cutoff);

    // 4. Kiểm tra limit
    if (timestamps.length >= opts.limit) {
      const oldestInWindow = timestamps[0];
      const retryAfterMs = oldestInWindow + windowMs - now;
      const retryAfterSecs = Math.ceil(retryAfterMs / 1000);

      c.header('X-RateLimit-Limit', String(opts.limit));
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset', String(Math.ceil((now + retryAfterMs) / 1000)));
      c.header('Retry-After', String(retryAfterSecs));

      return c.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: `Quá nhiều yêu cầu. Vui lòng thử lại sau ${retryAfterSecs} giây.`,
          },
        },
        429
      );
    }

    // 5. Thêm timestamp hiện tại và lưu lại
    timestamps.push(now);
    // TTL = window + 10s buffer để KV tự dọn
    await cache.put(kvKey, JSON.stringify(timestamps), {
      expirationTtl: opts.windowSecs + 10,
    });

    // 6. Thêm headers thông tin
    c.header('X-RateLimit-Limit', String(opts.limit));
    c.header('X-RateLimit-Remaining', String(opts.limit - timestamps.length));
    c.header('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));

    return next();
  };
}

// ─── Preset middlewares ────────────────────────────────────────────────────────

/** Auth endpoints: 10 req/phút per IP — chống brute force */
export const authRateLimit = rateLimit({
  limit: 10,
  windowSecs: 60,
  keyPrefix: 'auth',
  identifier: 'ip',
});

/** Profile updates: 10 req/10 phut per user — tranh spam cap nhat ho so */
export const profileUpdateRateLimit = rateLimit({
  limit: 10,
  windowSecs: 10 * 60,
  keyPrefix: 'profile-update',
  identifier: 'user',
});

/** AI scoring (writing submit, speaking turns): 20 req/phút per IP */
export const aiRateLimit = rateLimit({
  limit: 20,
  windowSecs: 60,
  keyPrefix: 'ai',
  identifier: 'ip',
});

/** General API: 100 req/phút per IP */
export const generalRateLimit = rateLimit({
  limit: 100,
  windowSecs: 60,
  keyPrefix: 'general',
  identifier: 'ip',
});
