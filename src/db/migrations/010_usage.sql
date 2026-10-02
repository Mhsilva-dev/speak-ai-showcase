-- Uso da API do Gemini: cada chamada (texto, áudio) e cada conversa por voz, com tokens e custo estimado
CREATE TABLE IF NOT EXISTS ai_usage (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,              -- live | text | audio
  task       TEXT NOT NULL,
  model      TEXT NOT NULL,
  ok         BOOLEAN NOT NULL DEFAULT true,
  error      TEXT,
  in_text    INT NOT NULL DEFAULT 0,
  in_audio   INT NOT NULL DEFAULT 0,
  out_text   INT NOT NULL DEFAULT 0,
  out_audio  INT NOT NULL DEFAULT 0,
  seconds    INT NOT NULL DEFAULT 0,     -- duração (conversa por voz)
  cost_usd   NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_created ON ai_usage(created_at);
CREATE INDEX IF NOT EXISTS ai_usage_user ON ai_usage(user_id, created_at);
-- Limite diário de voz por usuário (NULL = padrão do sistema)
ALTER TABLE users ADD COLUMN IF NOT EXISTS voice_daily_minutes INT;
