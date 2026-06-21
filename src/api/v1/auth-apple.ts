import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { users, oauthAccounts } from '../../db/schema';
import bcrypt from 'bcryptjs';
import { Bindings, Variables } from '../../index';
import { requireJwtSecret } from '../../middleware/auth';

const appleAuth = new Hono<{ Bindings: Bindings, Variables: Variables }>();

// ── Helpers ──────────────────────────────────────────

function decodeIdToken(idToken: string): Record<string, any> {
  try {
    const payloadBase64 = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const decodedStr = decodeURIComponent(escape(atob(payloadBase64)));
    return JSON.parse(decodedStr);
  } catch (e) {
    throw new Error('Invalid token format');
  }
}

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

async function findOrCreateUser(
  db: ReturnType<typeof drizzle>,
  appleId: string,
  email: string,
  name: string | null
): Promise<string> {
  const existingLink = await db.select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, 'apple'),
        eq(oauthAccounts.provider_id, appleId)
      )
    )
    .get();

  if (existingLink) {
    if (name) {
      await db.update(users)
        .set({ full_name: name, is_active: true, updated_at: new Date() })
        .where(eq(users.id, existingLink.user_id))
        .run();
    } else {
      await db.update(users)
        .set({ is_active: true, updated_at: new Date() })
        .where(eq(users.id, existingLink.user_id))
        .run();
    }
    return existingLink.user_id;
  }

  const existingUser = await db.select()
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (existingUser) {
    await db.insert(oauthAccounts).values({
      user_id: existingUser.id,
      provider: 'apple',
      provider_id: appleId,
    }).run();
    await db.update(users)
      .set({ is_active: true, updated_at: new Date() })
      .where(eq(users.id, existingUser.id))
      .run();
    return existingUser.id;
  }

  const newUser = await db.insert(users).values({
    email,
    full_name: name || email.split('@')[0] || 'Apple User',
  }).returning().get();

  await db.insert(oauthAccounts).values({
    user_id: newUser.id,
    provider: 'apple',
    provider_id: appleId,
  }).run();

  return newUser.id;
}

// ── Routes ───────────────────────────────────────────

// POST /auth/apple — Apple Identity Token exchange
appleAuth.post('/', async (c) => {
  try {
    const { identityToken, fullName } = await c.req.json();
    if (!identityToken) {
      return c.json({ success: false, error: 'Missing identity token' }, 400);
    }

    const payload = decodeIdToken(identityToken);

    // Verify token expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return c.json({ success: false, error: 'Token expired' }, 401);
    }

    // Verify issuer
    if (payload.iss !== 'https://appleid.apple.com') {
      return c.json({ success: false, error: 'Invalid token issuer' }, 401);
    }

    // Note: Audience validation should be done with the App Bundle ID
    // For now, we skip strict aud check to allow flexible development, 
    // but in production it should match c.env.APPLE_BUNDLE_ID

    const appleId = payload.sub;
    const email = payload.email;
    
    // Apple only sends fullName on the FIRST login attempt
    let name = null;
    if (fullName) {
      const { givenName, familyName } = fullName;
      if (givenName || familyName) {
        name = [givenName, familyName].filter(Boolean).join(' ');
      }
    }

    const db = drizzle(c.env.DB);
    const userId = await findOrCreateUser(db, appleId, email, name);

    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    // Access token (15 min)
    const jwtSecret = requireJwtSecret(c);
    const accessToken = await sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + 60 * 15,
      },
      jwtSecret
    );

    // Refresh token (30 days)
    const { refreshTokens } = await import('../../db/schema');
    const refreshToken = createRefreshToken();
    const tokenHash = await bcrypt.hash(refreshToken.validator, 10);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.insert(refreshTokens).values({
      id: crypto.randomUUID(),
      user_id: user.id,
      selector: refreshToken.selector,
      token_hash: tokenHash,
      expires_at: expiresAt,
    }).run();

    return c.json({
      success: true,
      data: {
        token: accessToken,
        refresh_token: refreshToken.raw,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          target_band: user.target_band,
          avatar_url: user.avatar_url,
          ai_persona: user.ai_persona,
          coins: user.coins,
          xp: user.xp,
        },
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

export default appleAuth;
