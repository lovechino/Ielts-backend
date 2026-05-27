import { Hono } from 'hono';
import { jwt, sign } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { users, courseEnrollments, courses, refreshTokens } from '../../db/schema';
import bcrypt from 'bcryptjs';
import { Bindings } from '../../index';
import googleAuth from './auth-google';

const auth = new Hono<{ Bindings: Bindings }>();

auth.route('/google', googleAuth);

// Helpers
const hashPassword = async (password: string) => bcrypt.hash(password, 10);
const comparePassword = async (password: string, hash: string) => bcrypt.compare(password, hash);
const randomToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
};

async function generateTokens(userId: string, email: string, role: string | null, secret: string, db: ReturnType<typeof drizzle>) {
  const accessToken = await sign(
    { sub: userId, email, role, exp: Math.floor(Date.now() / 1000) + 15 * 60 },
    secret
  );

  const rawRefresh = randomToken();
  const tokenHash = await bcrypt.hash(rawRefresh, 10);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  }).run();

  return { accessToken, refreshToken: rawRefresh };
}

async function refreshAccessToken(rawRefresh: string, secret: string, db: ReturnType<typeof drizzle>) {
  const now = new Date();
  const stored = await db.select()
    .from(refreshTokens)
    .where(and(
      gt(refreshTokens.expires_at, now),
      isNull(refreshTokens.revoked_at)
    ))
    .all();

  let matched: typeof stored[number] | null = null;
  for (const row of stored) {
    if (await bcrypt.compare(rawRefresh, row.token_hash)) {
      matched = row;
      break;
    }
  }
  if (!matched) return null;

  // Revoke old token
  await db.update(refreshTokens)
    .set({ revoked_at: now })
    .where(eq(refreshTokens.id, matched.id))
    .run();

  // Fetch user for new tokens
  const user = await db.select().from(users).where(eq(users.id, matched.user_id)).get();
  if (!user) return null;

  return generateTokens(user.id, user.email, user.role, secret, db);
}

// POST /register
auth.post('/register', async (c) => {
  const { email, password, full_name } = await c.req.json();
  if (!email || !password || !full_name) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  const db = drizzle(c.env.DB);
  const secret = c.env.JWT_SECRET || 'default-secret-key';

  const existingUser = await db.select().from(users).where(eq(users.email, email)).get();
  if (existingUser) {
    return c.json({ success: false, error: 'User already exists' }, 400);
  }

  const passwordHash = await hashPassword(password);

  try {
    const newUser = await db.insert(users).values({
      email,
      password_hash: passwordHash,
      full_name,
    }).returning().get();

    const tokens = await generateTokens(newUser.id, newUser.email, newUser.role, secret, db);

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
        },
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /login
auth.post('/login', async (c) => {
  const { email, password } = await c.req.json();
  const db = drizzle(c.env.DB);
  const secret = c.env.JWT_SECRET || 'default-secret-key';

  const user = await db.select().from(users).where(eq(users.email, email)).get();
  if (!user || !user.password_hash) {
    return c.json({ success: false, error: 'Invalid email or password' }, 401);
  }

  const isPasswordValid = await comparePassword(password, user.password_hash);
  if (!isPasswordValid) {
    return c.json({ success: false, error: 'Invalid email or password' }, 401);
  }

  const tokens = await generateTokens(user.id, user.email, user.role, secret, db);

  return c.json({
    success: true,
    data: {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
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
  const secret = c.env.JWT_SECRET || 'default-secret-key';

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

  const stored = await db.select()
    .from(refreshTokens)
    .where(and(
      gt(refreshTokens.expires_at, now),
      isNull(refreshTokens.revoked_at)
    ))
    .all();

  for (const row of stored) {
    if (await bcrypt.compare(refresh_token, row.token_hash)) {
      await db.update(refreshTokens)
        .set({ revoked_at: now })
        .where(eq(refreshTokens.id, row.id))
        .run();
      break;
    }
  }

  return c.json({ success: true, data: null });
});

// GET /me (Protected)
auth.get('/me', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  const jwtMiddleware = jwt({ secret, alg: 'HS256' });
  return jwtMiddleware(c, next);
}, async (c) => {
  const payload = c.get('jwtPayload') as any;
  const db = drizzle(c.env.DB);

  const user = await db.select().from(users).where(eq(users.id, payload.sub)).get();
  if (!user) {
    return c.json({ success: false, error: 'User not found' }, 404);
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
      enrolled_courses: enrolledCourses,
    },
  });
});

// PATCH /me (Protected)
auth.patch('/me', async (c, next) => {
  const secret = c.env.JWT_SECRET || 'default-secret-key';
  const jwtMiddleware = jwt({ secret, alg: 'HS256' });
  return jwtMiddleware(c, next);
}, async (c) => {
  const payload = c.get('jwtPayload') as any;
  const db = drizzle(c.env.DB);

  const body = await c.req.json();
  const allowedUpdates = ['full_name', 'target_band', 'avatar_url', 'ai_persona'];
  const updateData: Record<string, any> = {};

  for (const key of allowedUpdates) {
    if (body[key] !== undefined) {
      updateData[key] = body[key];
    }
  }

  if (Object.keys(updateData).length === 0) {
    return c.json({ success: false, error: 'No valid fields to update' }, 400);
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
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: { message: error.message } }, 500);
  }
});

export default auth;
