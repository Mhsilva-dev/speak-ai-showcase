CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Adicionar idioma = inserir linha aqui + arquivo de conteúdo em src/languages
CREATE TABLE IF NOT EXISTS languages (
  id                   SERIAL PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,
  slug                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  explanation_language TEXT NOT NULL DEFAULT 'pt-BR',
  active               BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS skills (
  id          SERIAL PRIMARY KEY,
  language_id INT NOT NULL REFERENCES languages(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL, -- grammar | vocabulary | pronunciation
  cefr_level  TEXT NOT NULL, -- A1..C1
  description TEXT,
  order_index INT NOT NULL DEFAULT 0,
  UNIQUE (language_id, code)
);

-- Ambiente do aluno em um idioma (progresso separado por idioma)
CREATE TABLE IF NOT EXISTS student_languages (
  id              SERIAL PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language_id     INT NOT NULL REFERENCES languages(id),
  level           TEXT NOT NULL DEFAULT 'A1',
  goal            TEXT NOT NULL DEFAULT 'fluencia',
  teaching_style  TEXT NOT NULL DEFAULT 'balanced',
  interests       TEXT[] NOT NULL DEFAULT '{}',
  xp              INT NOT NULL DEFAULT 0,
  streak_days     INT NOT NULL DEFAULT 0,
  last_study_date DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, language_id)
);

CREATE TABLE IF NOT EXISTS skill_mastery (
  student_language_id INT NOT NULL REFERENCES student_languages(id) ON DELETE CASCADE,
  skill_id            INT NOT NULL REFERENCES skills(id),
  score               INT NOT NULL DEFAULT 0,
  attempts            INT NOT NULL DEFAULT 0,
  correct             INT NOT NULL DEFAULT 0,
  last_practiced      TIMESTAMPTZ,
  PRIMARY KEY (student_language_id, skill_id)
);

-- speaking | grammar | vocabulary | listening | pronunciation
CREATE TABLE IF NOT EXISTS area_progress (
  student_language_id INT NOT NULL REFERENCES student_languages(id) ON DELETE CASCADE,
  area                TEXT NOT NULL,
  score               INT NOT NULL DEFAULT 0,
  PRIMARY KEY (student_language_id, area)
);

CREATE TABLE IF NOT EXISTS student_errors (
  id                  SERIAL PRIMARY KEY,
  student_language_id INT NOT NULL REFERENCES student_languages(id) ON DELETE CASCADE,
  skill_id            INT REFERENCES skills(id),
  error_type          TEXT NOT NULL,
  expected            TEXT NOT NULL,
  actual              TEXT NOT NULL,
  severity            TEXT NOT NULL DEFAULT 'medium', -- low | medium | critical
  frequency           INT NOT NULL DEFAULT 1,
  first_seen          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen           TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_review         TIMESTAMPTZ,
  srs_interval_days   INT NOT NULL DEFAULT 0,
  resolved            BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (student_language_id, error_type, expected, actual)
);

CREATE TABLE IF NOT EXISTS vocabulary (
  id                  SERIAL PRIMARY KEY,
  student_language_id INT NOT NULL REFERENCES student_languages(id) ON DELETE CASCADE,
  word                TEXT NOT NULL,
  translation         TEXT,
  meaning             TEXT,
  examples            JSONB NOT NULL DEFAULT '[]',
  level               TEXT,
  pronunciation       TEXT,
  mastery             INT NOT NULL DEFAULT 0,
  mistakes            INT NOT NULL DEFAULT 0,
  difficult           BOOLEAN NOT NULL DEFAULT false,
  srs_interval_days   INT NOT NULL DEFAULT 0,
  last_review         TIMESTAMPTZ,
  next_review         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_language_id, word)
);

CREATE TABLE IF NOT EXISTS lessons (
  id                  SERIAL PRIMARY KEY,
  student_language_id INT NOT NULL REFERENCES student_languages(id) ON DELETE CASCADE,
  skill_id            INT REFERENCES skills(id),
  topic               TEXT NOT NULL,
  state               TEXT NOT NULL,
  difficulty          INT NOT NULL DEFAULT 2, -- 1..5
  correct_streak      INT NOT NULL DEFAULT 0,
  current_item        INT NOT NULL DEFAULT 0,
  review_error_ids    INT[] NOT NULL DEFAULT '{}',
  summary             JSONB,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS lesson_items (
  id            SERIAL PRIMARY KEY,
  lesson_id     INT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  order_index   INT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'FREE_RESPONSE',
  prompt        TEXT NOT NULL,
  instruction_pt TEXT,
  model_answer  TEXT,
  difficulty    INT NOT NULL DEFAULT 2,
  attempts      INT NOT NULL DEFAULT 0,
  hints_used    INT NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | correct | failed
  UNIQUE (lesson_id, order_index)
);

CREATE TABLE IF NOT EXISTS messages (
  id         SERIAL PRIMARY KEY,
  lesson_id  INT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  role       TEXT NOT NULL, -- teacher | student
  kind       TEXT NOT NULL DEFAULT 'text', -- text | question | correct | correction | hint | summary
  content    TEXT NOT NULL,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_lesson ON messages(lesson_id, id);
CREATE INDEX IF NOT EXISTS idx_errors_student ON student_errors(student_language_id, resolved);
CREATE INDEX IF NOT EXISTS idx_lessons_student ON lessons(student_language_id, started_at DESC);
