import { Hono } from 'hono';
import { jwt, sign } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users, courseEnrollments, courses } from '../../db/schema';
import bcrypt from 'bcryptjs';
import { Bindings } from '../../index';

const auth = new Hono<{ Bindings: Bindings }>();

// Password Hashing helpers
const hashPassword = async (password: string) => {
  return await bcrypt.hash(password, 10);
};

const comparePassword = async (password: string, hash: string) => {
  return await bcrypt.compare(password, hash);
};

// POST /register
auth.post('/register', async (c) => {
  const { email, password, full_name } = await c.req.json();

  if (!email || !password || !full_name) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  const db = drizzle(c.env.DB);
  
  // Check if user exists
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

    return c.json({ success: true, data: { id: newUser.id, email: newUser.email, full_name: newUser.full_name } });
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

  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24 hours
  };

  const token = await sign(payload, secret);

  return c.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      }
    }
  });
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

  // Fetch enrolled courses
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
      enrolled_courses: enrolledCourses
    }
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
        ai_persona: updatedUser.ai_persona
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: { message: error.message } }, 500);
  }
});

export default auth;
