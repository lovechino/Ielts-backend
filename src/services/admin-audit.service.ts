import { drizzle } from 'drizzle-orm/d1';
import type { Context } from 'hono';
import { adminAuditLogs } from '../db/schema';
import type { Bindings, Variables } from '../index';

type AuditContext = Context<{ Bindings: Bindings, Variables: Variables }>;

export async function writeAdminAuditLog(
  c: AuditContext,
  action: string,
  options: {
    targetType?: string;
    targetId?: string | number | null;
    metadata?: Record<string, unknown>;
  } = {},
) {
  const payload = c.get('jwtPayload') as { sub?: string } | undefined;
  const db = drizzle(c.env.DB);

  await db.insert(adminAuditLogs).values({
    id: crypto.randomUUID(),
    admin_id: payload?.sub ?? null,
    action,
    target_type: options.targetType ?? null,
    target_id: options.targetId == null ? null : String(options.targetId),
    ip_address: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null,
    metadata: options.metadata ?? null,
  }).run();
}
