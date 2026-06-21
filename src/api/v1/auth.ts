import { Hono } from 'hono';
import { jwt, sign } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { users, courseEnrollments, courses, refreshTokens, devicePushTokens, userWordVault, userInventory, shopItems } from '../../db/schema';
import bcrypt from 'bcryptjs';
import { Bindings, Variables } from '../../index';
import googleAuth from './auth-google';
import appleAuth from './auth-apple';
import { authRateLimit, profileUpdateRateLimit } from '../../middleware/rateLimit';
import { requireJwtSecret } from '../../middleware/auth';

const auth = new Hono<{ Bindings: Bindings, Variables: Variables }>();
const FULL_NAME_CHANGE_COOLDOWN_SECONDS = 7 * 24 * 60 * 60;

auth.route('/google', googleAuth);
auth.route('/apple', appleAuth);

// Helpers
const hashPassword = async (password: string) => bcrypt.hash(password, 10);
const comparePassword = async (password: string, hash: string) => bcrypt.compare(password, hash);
const randomToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
};

const createRefreshToken = () => {
  const selector = randomToken().slice(0, 24);
  const validator = randomToken();
  return { selector, validator, raw: `${selector}.${validator}` };
};

const parseRefreshToken = (raw: string) => {
  const [selector, validator, ...rest] = raw.split('.');
  if (!selector || !validator || rest.length > 0) return null;
  return { selector, validator };
};

const normalizeFullName = (value: unknown) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

async function generateTokens(userId: string, email: string, role: string | null, secret: string, db: ReturnType<typeof drizzle>) {
  const accessToken = await sign(
    { sub: userId, email, role, exp: Math.floor(Date.now() / 1000) + 15 * 60 },
    secret
  );

  const refresh = createRefreshToken();
  const tokenHash = await bcrypt.hash(refresh.validator, 10);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({
    user_id: userId,
    selector: refresh.selector,
    token_hash: tokenHash,
    expires_at: expiresAt,
  }).run();

  return { accessToken, refreshToken: refresh.raw };
}

async function refreshAccessToken(rawRefresh: string, secret: string, db: ReturnType<typeof drizzle>) {
  const now = new Date();
  const parsed = parseRefreshToken(rawRefresh);
  if (!parsed) return null;

  const matched = await db.select()
    .from(refreshTokens)
    .where(and(
      eq(refreshTokens.selector, parsed.selector),
      gt(refreshTokens.expires_at, now),
      isNull(refreshTokens.revoked_at)
    ))
    .get();
  if (!matched || !(await bcrypt.compare(parsed.validator, matched.token_hash))) return null;

  // Revoke old token
  await db.update(refreshTokens)
    .set({ revoked_at: now })
    .where(eq(refreshTokens.id, matched.id))
    .run();

  // Fetch user for new tokens
  const user = await db.select().from(users).where(eq(users.id, matched.user_id)).get();
  if (!user) return null;
  if (!user.is_active) return null;

  return generateTokens(user.id, user.email, user.role, secret, db);
}

// POST /register
auth.post('/register', authRateLimit, async (c) => {
  const { email, password, full_name } = await c.req.json();
  const normalizedFullName = normalizeFullName(full_name);
  if (!email || !password || !normalizedFullName) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }
  if (normalizedFullName.length < 2 || normalizedFullName.length > 40) {
    return c.json({ success: false, error: 'Full name must be 2-40 characters' }, 400);
  }

  const db = drizzle(c.env.DB);
  const secret = requireJwtSecret(c);

  const existingUser = await db.select().from(users).where(eq(users.email, email)).get();
  if (existingUser) {
    return c.json({ success: false, error: 'User already exists' }, 400);
  }

  const passwordHash = await hashPassword(password);

  try {
    const newUser = await db.insert(users).values({
      email,
      password_hash: passwordHash,
      full_name: normalizedFullName,
    }).returning().get();

    const tokens = await generateTokens(newUser.id, newUser.email, newUser.role, secret, db);

    if (c.env.EMAIL_QUEUE) {
      await c.env.EMAIL_QUEUE.send({
        type: 'welcome',
        email: newUser.email,
        name: newUser.full_name
      });
    }

    return c.json({
      success: true,
      data: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        user: {
          id: newUser.id,
          email: newUser.email,
          full_name: newUser.full_name,
          role: newUser.role,
          has_completed_assessment: newUser.has_completed_assessment,
        },
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /login
auth.post('/login', authRateLimit, async (c) => {
  const { email, password } = await c.req.json();
  const db = drizzle(c.env.DB);
  const secret = requireJwtSecret(c);

  const user = await db.select().from(users).where(eq(users.email, email)).get();
  if (!user || !user.password_hash) {
    return c.json({ success: false, error: 'Invalid email or password' }, 401);
  }

  const isPasswordValid = await comparePassword(password, user.password_hash);
  if (!isPasswordValid) {
    return c.json({ success: false, error: 'Invalid email or password' }, 401);
  }

  const activeUser = user.is_active
    ? user
    : await db.update(users)
        .set({ is_active: true, updated_at: new Date() })
        .where(eq(users.id, user.id))
        .returning()
        .get();

  const tokens = await generateTokens(activeUser.id, activeUser.email, activeUser.role, secret, db);

  return c.json({
    success: true,
    data: {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      user: {
        id: activeUser.id,
        email: activeUser.email,
        full_name: activeUser.full_name,
        role: activeUser.role,
        target_band: activeUser.target_band,
        avatar_url: activeUser.avatar_url,
        ai_persona: activeUser.ai_persona,
        has_completed_assessment: activeUser.has_completed_assessment,
        coins: activeUser.coins,
        xp: activeUser.xp,
      },
    },
  });
});

// POST /refresh
auth.post('/refresh', async (c) => {
  const { refresh_token } = await c.req.json();
  if (!refresh_token) {
    return c.json({ success: false, error: 'Refresh token required' }, 400);
  }

  const db = drizzle(c.env.DB);
  const secret = requireJwtSecret(c);

  const result = await refreshAccessToken(refresh_token, secret, db);
  if (!result) {
    return c.json({ success: false, error: 'Invalid or expired refresh token' }, 401);
  }

  return c.json({
    success: true,
    data: {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
    },
  });
});

// POST /logout
auth.post('/logout', async (c) => {
  const { refresh_token } = await c.req.json();
  if (!refresh_token) {
    return c.json({ success: false, error: 'Refresh token required' }, 400);
  }

  const db = drizzle(c.env.DB);
  const now = new Date();
  const parsed = parseRefreshToken(refresh_token);
  if (!parsed) {
    return c.json({ success: true, data: null });
  }

  const stored = await db.select()
    .from(refreshTokens)
    .where(and(
      eq(refreshTokens.selector, parsed.selector),
      gt(refreshTokens.expires_at, now),
      isNull(refreshTokens.revoked_at)
    ))
    .get();

  if (stored && await bcrypt.compare(parsed.validator, stored.token_hash)) {
    await db.update(refreshTokens)
      .set({ revoked_at: now })
      .where(eq(refreshTokens.id, stored.id))
      .run();
  }

  return c.json({ success: true, data: null });
});

// GET /me (Protected)
auth.get('/me', async (c, next) => {
  const secret = requireJwtSecret(c);
  const jwtMiddleware = jwt({ secret, alg: 'HS256' });
  return jwtMiddleware(c, next);
}, async (c) => {
  const payload = c.get('jwtPayload') as any;
  const db = drizzle(c.env.DB);

  const user = await db.select().from(users).where(eq(users.id, payload.sub)).get();
  if (!user) {
    return c.json({ success: false, error: 'User not found' }, 404);
  }
  if (!user.is_active) {
    return c.json({ success: false, error: { code: 'ACCOUNT_DEACTIVATED', message: 'Account is deactivated. Please log in again to restore it.' } }, 403);
  }

  const enrolledCourses = await db.select({
    id: courses.id,
    title: courses.title,
    thumbnail_url: courses.thumbnail_url,
    enrolled_at: courseEnrollments.enrolled_at,
    status: courseEnrollments.status,
  }).from(courseEnrollments)
    .innerJoin(courses, eq(courseEnrollments.course_id, courses.id))
    .where(eq(courseEnrollments.user_id, payload.sub))
    .all();

  // Tính toán Vault Limits
  const coursesRaw = await db.select({ group_name: userWordVault.group_name })
    .from(userWordVault)
    .where(eq(userWordVault.user_id, payload.sub))
    .groupBy(userWordVault.group_name)
    .all();
  
  const current_courses = coursesRaw.length;

  const inventoryRows = await db.select({ quantity: userInventory.quantity, metadata: shopItems.metadata })
    .from(userInventory)
    .innerJoin(shopItems, eq(userInventory.item_id, shopItems.id))
    .where(eq(userInventory.user_id, payload.sub))
    .all();

  let extra_slots = 0;
  for (const row of inventoryRows) {
    if (row.metadata) {
       const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
       if (meta?.effect === 'extra_course_slot') {
         extra_slots += (row.quantity || 1) * (meta.value || 1);
       }
    }
  }

  const base_limit = user.tier === 'premium' ? 9999 : 3;
  const vault_limits = {
    current_courses,
    limit: base_limit + extra_slots,
  };

  return c.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      target_band: user.target_band,
      avatar_url: user.avatar_url,
      ai_persona: user.ai_persona,
      has_completed_assessment: user.has_completed_assessment,
      coins: user.coins,
      xp: user.xp,
      enrolled_courses: enrolledCourses,
      vault_limits,
    },
  });
});

// PATCH /me (Protected)
auth.patch('/me', async (c, next) => {
  const secret = requireJwtSecret(c);
  const jwtMiddleware = jwt({ secret, alg: 'HS256' });
  return jwtMiddleware(c, next);
}, profileUpdateRateLimit, async (c) => {
  const payload = c.get('jwtPayload') as any;
  const db = drizzle(c.env.DB);

  const body = await c.req.json();
  const allowedUpdates = ['full_name', 'target_band', 'avatar_url', 'ai_persona', 'has_completed_assessment'];
  const updateData: Record<string, any> = {};
  let shouldWriteNameCooldown = false;

  for (const key of allowedUpdates) {
    if (body[key] !== undefined) {
      updateData[key] = body[key];
    }
  }

  if (Object.keys(updateData).length === 0) {
    return c.json({ success: false, error: 'No valid fields to update' }, 400);
  }

  if (body.full_name !== undefined) {
    const normalizedFullName = normalizeFullName(body.full_name);
    if (normalizedFullName.length < 2 || normalizedFullName.length > 40) {
      return c.json({ success: false, error: 'Full name must be 2-40 characters' }, 400);
    }

    const currentUser = await db.select().from(users).where(eq(users.id, payload.sub)).get();
    if (!currentUser) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    if (normalizedFullName !== currentUser.full_name) {
      const cooldownKey = `profile:name-change:${payload.sub}`;
      const activeCooldown = await c.env.CACHE.get(cooldownKey);
      if (activeCooldown) {
        return c.json({
          success: false,
          error: {
            code: 'FULL_NAME_CHANGE_COOLDOWN',
            message: 'You can change your full name once every 7 days.',
          },
        }, 429);
      }

      updateData.full_name = normalizedFullName;
      shouldWriteNameCooldown = true;
    } else {
      delete updateData.full_name;
    }
  }

  if (Object.keys(updateData).length === 0) {
    return c.json({ success: false, error: 'No changes to update' }, 400);
  }

  updateData.updated_at = new Date();

  try {
    const updatedUser = await db.update(users)
      .set(updateData)
      .where(eq(users.id, payload.sub))
      .returning()
      .get();

    if (!updatedUser) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    if (shouldWriteNameCooldown) {
      await c.env.CACHE.put(
        `profile:name-change:${payload.sub}`,
        String(Date.now()),
        { expirationTtl: FULL_NAME_CHANGE_COOLDOWN_SECONDS }
      );
    }

    return c.json({
      success: true,
      data: {
        id: updatedUser.id,
        email: updatedUser.email,
        full_name: updatedUser.full_name,
        role: updatedUser.role,
        target_band: updatedUser.target_band,
        avatar_url: updatedUser.avatar_url,
        ai_persona: updatedUser.ai_persona,
        has_completed_assessment: updatedUser.has_completed_assessment,
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: { message: error.message } }, 500);
  }
});

// POST /device-token (Protected) — đăng ký Expo push token
auth.post('/device-token', async (c, next) => {
  const secret = requireJwtSecret(c);
  return jwt({ secret, alg: 'HS256' })(c, next);
}, async (c) => {
  const payload = c.get('jwtPayload') as any;
  const userId = payload.sub;
  const { expo_push_token, platform } = await c.req.json();

  if (!expo_push_token || !platform) {
    return c.json({ success: false, error: 'expo_push_token and platform are required' }, 400);
  }

  const db = drizzle(c.env.DB);

  try {
    await db.insert(devicePushTokens)
      .values({
        user_id: userId,
        expo_push_token,
        platform,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [devicePushTokens.user_id, devicePushTokens.expo_push_token],
        set: { platform, updated_at: new Date() },
      })
      .run();

    return c.json({ success: true, data: null });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// DELETE /device-token (Protected) — xóa push token khi logout
auth.delete('/device-token', async (c, next) => {
  const secret = requireJwtSecret(c);
  return jwt({ secret, alg: 'HS256' })(c, next);
}, async (c) => {
  const payload = c.get('jwtPayload') as any;
  const userId = payload.sub;
  const { expo_push_token } = await c.req.json();

  if (!expo_push_token) {
    return c.json({ success: false, error: 'expo_push_token is required' }, 400);
  }

  const db = drizzle(c.env.DB);

  try {
    await db.delete(devicePushTokens)
      .where(
        and(
          eq(devicePushTokens.user_id, userId),
          eq(devicePushTokens.expo_push_token, expo_push_token),
        )
      )
      .run();

    return c.json({ success: true, data: null });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// DELETE /me (Protected) — Tạm khóa tài khoản, giữ dữ liệu để có thể khôi phục
auth.delete('/me', async (c, next) => {
  const secret = requireJwtSecret(c);
  const jwtMiddleware = jwt({ secret, alg: 'HS256' });
  return jwtMiddleware(c, next);
}, async (c) => {
  const payload = c.get('jwtPayload') as any;
  const db = drizzle(c.env.DB);

  try {
    const now = new Date();
    const result = await db.update(users)
      .set({ is_active: false, updated_at: now })
      .where(eq(users.id, payload.sub))
      .run();
    
    if (result.meta.changes === 0) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    await db.update(refreshTokens)
      .set({ revoked_at: now })
      .where(eq(refreshTokens.user_id, payload.sub))
      .run();

    await db.delete(devicePushTokens)
      .where(eq(devicePushTokens.user_id, payload.sub))
      .run();

    return c.json({ success: true, data: { message: 'Account deactivated successfully' } });
  } catch (error: any) {
    return c.json({ success: false, error: { message: error.message } }, 500);
  }
});

export default auth;

// POST /auth/promote-admin
// Body: { email, admin_secret }
// Chỉ hoạt động khi ADMIN_SECRET được set trong env.
// Không cần JWT — ai biết secret mới dùng được.
// Rate limit: dùng authRateLimit (10 req/phút/IP).
auth.post('/promote-admin', authRateLimit, async (c) => {
  const adminSecret = c.env.ADMIN_SECRET;

  // Disabled by default. Enable only for local/bootstrap maintenance windows.
  if (c.env.ENABLE_PROMOTE_ADMIN !== 'true' || !adminSecret) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }

  const { email, admin_secret } = await c.req.json();

  if (!email || !admin_secret) {
    return c.json({ success: false, error: 'email and admin_secret are required' }, 400);
  }

  // So sánh constant-time để chống timing attack
  const secretMatch = admin_secret.length === adminSecret.length &&
    admin_secret === adminSecret;

  if (!secretMatch) {
    // Log IP để monitor brute-force
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    console.warn(`[Security] Failed promote-admin attempt from IP: ${ip}, email: ${email}`);
    return c.json({ success: false, error: 'Invalid secret' }, 403);
  }

  const db = drizzle(c.env.DB);
  const user = await db.select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (!user) {
    return c.json({ success: false, error: 'User not found' }, 404);
  }

  if (user.role === 'admin') {
    return c.json({ success: true, data: { message: 'Already admin' } });
  }

  await db.update(users)
    .set({ role: 'admin', updated_at: new Date() })
    .where(eq(users.id, user.id))
    .run();

  console.log(`[Security] User promoted to admin: ${email}`);
  return c.json({ success: true, data: { message: `${email} is now admin` } });
});
