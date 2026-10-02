-- Lembrete diário por push: aparelhos inscritos + horário escolhido (NULL = desligado)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reminder_hour INT DEFAULT 19;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reminder_sent_on DATE;
