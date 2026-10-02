-- Relatório semanal por e-mail (segunda de manhã); o aluno pode desligar
ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_email BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_email_sent_at TIMESTAMPTZ;
