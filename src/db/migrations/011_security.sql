-- Segurança das contas:
-- session_version: aumenta quando a senha muda (derruba as sessões abertas em outros aparelhos)
-- email_verified: e-mail comprovado (Google ou link de redefinição). Ao ligar o Google a uma conta
--   com e-mail NÃO comprovado, a senha antiga é apagada (evita que alguém crie a conta antes com o e-mail de outra pessoa)
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
UPDATE users SET email_verified = true WHERE google_id IS NOT NULL AND NOT email_verified;
-- Para limitar quantos e-mails de redefinição saem para a mesma pessoa
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
