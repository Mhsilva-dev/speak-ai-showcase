# Banco de dados

PostgreSQL. O progresso é sempre **por idioma**: um aluno que estuda inglês e espanhol tem dois `student_languages`, cada um com seus níveis, erros, vocabulário e conquistas.

```mermaid
erDiagram
    users ||--o{ student_languages : estuda
    languages ||--o{ student_languages : ""
    languages ||--o{ skills : "currículo"
    student_languages ||--o{ skill_mastery : ""
    skills ||--o{ skill_mastery : ""
    student_languages ||--o{ area_progress : ""
    student_languages ||--o{ area_history : "foto diária"
    student_languages ||--o{ lessons : ""
    lessons ||--o{ lesson_items : ""
    lessons ||--o{ messages : ""
    student_languages ||--o{ student_errors : ""
    student_languages ||--o{ vocabulary : ""
    vocabulary ||--o{ vocab_reviews : ""
    student_languages ||--o{ xp_events : ""
    student_languages ||--o{ student_achievements : ""
    student_languages ||--o{ pronunciation_attempts : ""
    student_languages ||--o{ materials : ""
    student_languages ||--o{ student_memories : ""
    users ||--o{ placement_tests : ""
    users ||--o{ password_resets : ""
    users ||--o{ push_subscriptions : ""
    users ||--o{ ai_usage : ""

    users {
        int id PK
        text email UK
        text password_hash "nulo se só entra com Google"
        text google_id UK
        bool email_verified
        int session_version
        bool is_admin
        bool blocked
        int voice_daily_minutes "nulo = padrão"
        int reminder_hour
        bool weekly_email
    }
    student_languages {
        int id PK
        int user_id FK
        int language_id FK
        text level "A1..C1"
        text goal
        text teaching_style
        text teacher_voice
        int xp
        int streak_days
    }
    lessons {
        int id PK
        text mode "lesson, daily, words, material, conversation, roleplay, live, tutor"
        text state "máquina de estados"
        int difficulty
        jsonb summary
    }
    messages {
        int id PK
        int lesson_id FK
        text role "teacher | student"
        text kind "question, correction, hint, reply…"
        jsonb payload
    }
    student_errors {
        int id PK
        text error_type
        text expected
        text actual
        int frequency
        text source "lesson | conversation | live"
        timestamptz next_review
    }
    vocabulary {
        int id PK
        text word
        text translation
        int mastery
        int srs_interval_days
        timestamptz next_review
    }
    ai_usage {
        bigint id PK
        int user_id FK
        text kind "live | text | audio"
        text model
        int in_text
        int in_audio
        int out_text
        int out_audio
        int seconds
        numeric cost_usd
    }
```

## Notas

- `skills` é preenchida a partir de `src/languages/*.js` toda vez que o servidor sobe (novas habilidades entram sozinhas); adicionar um idioma é criar o arquivo de conteúdo e registrá-lo.
- `student_errors` tem chave única em `(student_language_id, error_type, expected, actual)`: repetir o mesmo erro aumenta a frequência em vez de duplicar.
- `password_resets` guarda só o hash do token.
- `ai_usage` mantém o histórico mesmo se o usuário for excluído (`ON DELETE SET NULL`), para o custo total continuar correto.
