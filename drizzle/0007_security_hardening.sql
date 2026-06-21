ALTER TABLE refresh_tokens ADD COLUMN selector text;
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_selector_unique ON refresh_tokens(selector);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id text PRIMARY KEY NOT NULL,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  user_id text,
  event_type text,
  processed_at integer DEFAULT CURRENT_TIMESTAMP,
  metadata text,
  FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_events_provider_event_id_unique ON payment_webhook_events(provider_event_id);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id text PRIMARY KEY NOT NULL,
  admin_id text,
  action text NOT NULL,
  target_type text,
  target_id text,
  ip_address text,
  metadata text,
  created_at integer DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON UPDATE no action ON DELETE set null
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_logs(admin_id, action);
