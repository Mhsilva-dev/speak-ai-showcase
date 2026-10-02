-- Modos de aula: lesson (estruturada) | daily (aula do dia) | material (foto/PDF) | conversation | roleplay
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'lesson';
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS scenario TEXT;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS target_turns INT;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS turns INT NOT NULL DEFAULT 0;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS retry_pending INT NOT NULL DEFAULT 0;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS material_id INT;

-- Itens que revisam uma palavra ou um erro antigo alimentam a repetição espaçada
ALTER TABLE lesson_items ADD COLUMN IF NOT EXISTS vocab_id INT REFERENCES vocabulary(id) ON DELETE SET NULL;
ALTER TABLE lesson_items ADD COLUMN IF NOT EXISTS error_id INT REFERENCES student_errors(id) ON DELETE SET NULL;

ALTER TABLE student_languages ADD COLUMN IF NOT EXISTS daily_goal_xp INT NOT NULL DEFAULT 50;
ALTER TABLE student_languages ADD COLUMN IF NOT EXISTS weekly_goal_lessons INT NOT NULL DEFAULT 5;
ALTER TABLE student_languages ADD COLUMN IF NOT EXISTS placement JSONB;

CREATE TABLE IF NOT EXISTS placement_tests (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language_id INT NOT NULL REFERENCES languages(id),
  bank        JSONB NOT NULL,          -- perguntas por nível geradas pela IA
  asked       JSONB NOT NULL DEFAULT '[]', -- [{level, index, answer, score}]
  current     JSONB,                   -- {level, index}
  result      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS xp_events (
  id                  SERIAL PRIMARY KEY,
  student_language_id INT NOT NULL REFERENCES student_languages(id) ON DELETE CASCADE,
  amount              INT NOT NULL,
  reason              TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_xp_events ON xp_events(student_language_id, created_at);

CREATE TABLE IF NOT EXISTS student_achievements (
  student_language_id INT NOT NULL REFERENCES student_languages(id) ON DELETE CASCADE,
  code                TEXT NOT NULL,
  unlocked_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_language_id, code)
);

-- Foto do valor de cada área por dia (para o relatório semanal)
CREATE TABLE IF NOT EXISTS area_history (
  student_language_id INT NOT NULL REFERENCES student_languages(id) ON DELETE CASCADE,
  day                 DATE NOT NULL,
  area                TEXT NOT NULL,
  score               INT NOT NULL,
  PRIMARY KEY (student_language_id, day, area)
);

CREATE TABLE IF NOT EXISTS vocab_reviews (
  id                  SERIAL PRIMARY KEY,
  student_language_id INT NOT NULL REFERENCES student_languages(id) ON DELETE CASCADE,
  vocab_id            INT REFERENCES vocabulary(id) ON DELETE SET NULL,
  success             BOOLEAN NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pronunciation_attempts (
  id                  SERIAL PRIMARY KEY,
  student_language_id INT NOT NULL REFERENCES student_languages(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL, -- shadowing | listening
  module              TEXT,
  text                TEXT NOT NULL,
  transcript          TEXT,
  score               INT NOT NULL,
  problems            JSONB NOT NULL DEFAULT '[]',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS materials (
  id                  SERIAL PRIMARY KEY,
  student_language_id INT NOT NULL REFERENCES student_languages(id) ON DELETE CASCADE,
  file_path           TEXT NOT NULL,
  mime                TEXT NOT NULL,
  original_name       TEXT,
  analysis            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
