import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { users, oauthAccounts } from '../../db/schema';
import { Bindings } from '../../index';

const googleAuth = new Hono<{ Bindings: Bindings }>();

// ── Helpers ──────────────────────────────────────────

function decodeIdToken(idToken: string): Record<string, any> {
  const payloadBase64 = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  // Dùng escape/decodeURIComponent kết hợp atob để giữ nguyên được tiếng Việt (UTF-8)
  const decodedStr = decodeURIComponent(escape(atob(payloadBase64)));
  return JSON.parse(decodedStr);
}

async function findOrCreateUser(
  db: ReturnType<typeof drizzle>,
  googleId: string,
  email: string,
  name: string,
  avatarUrl: string | null
): Promise<string> {
  const existingLink = await db.select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, 'google'),
        eq(oauthAccounts.provider_id, googleId)
      )
    )
    .get();

  if (existingLink) {
    await db.update(users)
      .set({ avatar_url: avatarUrl, full_name: name, updated_at: new Date() })
      .where(eq(users.id, existingLink.user_id))
      .run();
    return existingLink.user_id;
  }

  const existingUser = await db.select()
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (existingUser) {
    await db.insert(oauthAccounts).values({
      user_id: existingUser.id,
      provider: 'google',
      provider_id: googleId,
    }).run();
    await db.update(users)
      .set({ avatar_url: avatarUrl, updated_at: new Date() })
      .where(eq(users.id, existingUser.id))
      .run();
    return existingUser.id;
  }

  const newUser = await db.insert(users).values({
    email,
    full_name: name,
    avatar_url: avatarUrl,
  }).returning().get();

  await db.insert(oauthAccounts).values({
    user_id: newUser.id,
    provider: 'google',
    provider_id: googleId,
  }).run();

  return newUser.id;
}

function buildRedirectRes(location: string, cookie?: { name: string; value: string; maxAge: number }): Response {
  const headers: Record<string, string> = { 'Location': location };
  if (cookie) {
    const { name, value, maxAge } = cookie;
    headers['Set-Cookie'] = `${name}=${value}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Path=/`;
  }
  return new Response(null, { status: 302, headers });
}

// ── Routes ───────────────────────────────────────────

// POST /auth/google — Authorization code exchange (mobile / SPA)
googleAuth.post('/', async (c) => {
  try {
    const { code, redirect_uri } = await c.req.json();
    if (!code) {
      return c.json({ success: false, error: 'Missing authorization code' }, 400);
    }

    const clientId = c.env.GOOGLE_CLIENT_ID;
    const clientSecret = c.env.GOOGLE_CLIENT_SECRET;

    const params: Record<string, string> = {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
    };
    if (redirect_uri) {
      params.redirect_uri = redirect_uri;
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return c.json({ success: false, error: `Token exchange failed: ${errorText}` }, 401);
    }

    const tokens = await tokenResponse.json() as Record<string, any>;
    const payload = decodeIdToken(tokens.id_token);

    if (payload.aud !== clientId) {
      return c.json({ success: false, error: 'Token audience mismatch' }, 401);
    }
    if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
      return c.json({ success: false, error: 'Invalid token issuer' }, 401);
    }
    if (!payload.email_verified) {
      return c.json({ success: false, error: 'Google email not verified' }, 401);
    }

    const googleId: string = payload.sub;
    const email: string = payload.email;
    const name: string = payload.name || email.split('@')[0] || 'Google User';
    const avatarUrl: string | null = payload.picture || null;

    const db = drizzle(c.env.DB);
    const userId = await findOrCreateUser(db, googleId, email, name, avatarUrl);

    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    const token = await sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      },
      c.env.JWT_SECRET
    );

    return c.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          avatar_url: user.avatar_url,
        },
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /auth/google — OAuth2 redirect (web)
googleAuth.get('/', async (c) => {
  const url = new URL(c.req.url);
  const redirectUri = `${url.origin}/api/v1/auth/google/callback`;
  const state = crypto.randomUUID();

  const clientId = c.env.GOOGLE_CLIENT_ID || '109247400665-t0ck01im9o7neqkcms0nclkn2s674089.apps.googleusercontent.com';

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  }).toString()}`;

  return buildRedirectRes(authUrl, { name: 'google_oauth_state', value: state, maxAge: 600 });
});

// GET /auth/google/callback — OAuth2 callback
googleAuth.get('/callback', async (c) => {
  try {
    const { code, state } = c.req.query();
    const url = new URL(c.req.url);
    const redirectUri = `${url.origin}/api/v1/auth/google/callback`;

    const cookies = c.req.header('Cookie') || '';
    const cookieState = cookies
      .split(';')
      .map(s => s.trim())
      .find(s => s.startsWith('google_oauth_state='))
      ?.split('=')[1];

    if (!state || !cookieState || state !== cookieState) {
      return c.json({ success: false, error: 'Invalid state parameter' }, 401);
    }
    if (!code) {
      return c.json({ success: false, error: 'Missing authorization code' }, 400);
    }

    const clientId = c.env.GOOGLE_CLIENT_ID;
    const clientSecret = c.env.GOOGLE_CLIENT_SECRET;

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return c.json({ success: false, error: `Token exchange failed: ${errorText}` }, 401);
    }

    const tokens = await tokenResponse.json() as Record<string, any>;
    const payload = decodeIdToken(tokens.id_token);

    if (payload.aud !== clientId) {
      return c.json({ success: false, error: 'Token audience mismatch' }, 401);
    }

    const googleId: string = payload.sub;
    const email: string = payload.email;
    const name: string = payload.name || email.split('@')[0] || 'Google User';
    const avatarUrl: string | null = payload.picture || null;

    const db = drizzle(c.env.DB);
    const userId = await findOrCreateUser(db, googleId, email, name, avatarUrl);

    const user = await db.select().from(users).where(eq(users.id, userId)).get();

    const token = await sign(
      {
        sub: user!.id,
        email: user!.email,
        role: user!.role,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      },
      c.env.JWT_SECRET
    );

    // Bỏ qua c.env.FRONTEND_URL vì nó đang dính cổng 3000 của dự án NextJS cũ trong wrangler.jsonc
    const frontendUrl = 'http://localhost:8081';

    return buildRedirectRes(
      `${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}`,
      { name: 'google_oauth_state', value: '', maxAge: 0 }
    );
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

export default googleAuth;
