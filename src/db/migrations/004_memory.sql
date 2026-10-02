-- Memória do aluno entre aulas: fatos pessoais, interesses, planos e resumos das conversas
CREATE TABLE IF NOT EXISTS student_memories (
  id                  SERIAL PRIMARY KEY,
  student_language_id INT NOT NULL REFERENCES student_languages(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL DEFAULT 'fact', -- fact | session
  content             TEXT NOT NULL,
  lesson_id           INT REFERENCES lessons(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memories_student ON student_memories(student_language_id, created_at DESC);

-- De onde veio cada erro (aula escrita, conversa por texto ou por voz)
ALTER TABLE student_errors ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'lesson';
ALTER TABLE student_errors ADD COLUMN IF NOT EXISTS source_lesson_id INT;
