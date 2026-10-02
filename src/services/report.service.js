// Relatório semanal + metas + conquistas
const db = require('../db/pool');
const students = require('./student.service');
const engine = require('./pedagogy/engine');
const { ACHIEVEMENTS, goalProgress } = require('./pedagogy/gamification');
const { AREAS } = require('../languages');
const { TODAY } = require('./progress.service');

const MINUTES_PER = { flashcard: 0.3, shadowing: 1, listening: 1 };

async function goals(slId, student) {
  const { rows: [r] } = await db.query(
    `SELECT
       COALESCE((SELECT sum(amount) FROM xp_events WHERE student_language_id=$1 AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date = ${TODAY}),0)::int AS xp_today,
       (SELECT count(*) FROM lessons WHERE student_language_id=$1 AND state='LESSON_COMPLETED'
          AND (completed_at AT TIME ZONE 'America/Sao_Paulo')::date > ${TODAY} - 7)::int AS lessons_week,
       EXISTS(SELECT 1 FROM lessons WHERE student_language_id=$1 AND mode='daily' AND state='LESSON_COMPLETED'
          AND (completed_at AT TIME ZONE 'America/Sao_Paulo')::date = ${TODAY}) AS daily_done`, [slId]);
  return {
    daily: goalProgress(r.xp_today, student.daily_goal_xp),
    weekly: goalProgress(r.lessons_week, student.weekly_goal_lessons),
    dailyLessonDone: r.daily_done,
  };
}

async function achievements(slId) {
  const { rows } = await db.query('SELECT code, unlocked_at FROM student_achievements WHERE student_language_id=$1', [slId]);
  const got = Object.fromEntries(rows.map((r) => [r.code, r.unlocked_at]));
  return ACHIEVEMENTS.map(({ code, icon, name, desc }) => ({ code, icon, name, desc, unlockedAt: got[code] || null }));
}

async function weekly(userId, slug) {
  const { student } = await students.requireStudentLanguage(userId, slug);
  const id = student.id;
  const since = `${TODAY} - 6`; // 7 dias incluindo hoje
  const [lessonsQ, xpQ, vocabQ, errorsQ, pronQ, histQ, areasQ, topErrQ, daysQ] = await Promise.all([
    db.query(`SELECT mode, count(*)::int AS n,
                COALESCE(sum(LEAST(EXTRACT(EPOCH FROM (completed_at - started_at))/60, 45)),0)::float AS minutes,
                round(avg((summary->>'accuracy')::int))::int AS accuracy
              FROM lessons WHERE student_language_id=$1 AND state='LESSON_COMPLETED'
                AND (completed_at AT TIME ZONE 'America/Sao_Paulo')::date >= ${since} GROUP BY mode`, [id]),
    db.query(`SELECT COALESCE(sum(amount),0)::int AS xp FROM xp_events WHERE student_language_id=$1 AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date >= ${since}`, [id]),
    db.query(`SELECT
                (SELECT count(*) FROM vocabulary WHERE student_language_id=$1 AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date >= ${since})::int AS added,
                (SELECT count(*) FROM vocab_reviews WHERE student_language_id=$1 AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date >= ${since})::int AS reviews,
                (SELECT count(DISTINCT vocab_id) FROM vocab_reviews WHERE student_language_id=$1 AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date >= ${since})::int AS reviewed_words`, [id]),
    db.query(`SELECT count(*)::int AS n FROM messages m JOIN lessons l ON l.id=m.lesson_id
              WHERE l.student_language_id=$1 AND m.kind IN ('correction','note') AND (m.created_at AT TIME ZONE 'America/Sao_Paulo')::date >= ${since}`, [id]),
    db.query(`SELECT kind, count(*)::int AS n, round(avg(score))::int AS avg FROM pronunciation_attempts
              WHERE student_language_id=$1 AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date >= ${since} GROUP BY kind`, [id]),
    // valor de cada área no início da semana (último registro antes do período)
    db.query(`SELECT DISTINCT ON (area) area, score FROM area_history WHERE student_language_id=$1 AND day < ${since} ORDER BY area, day DESC`, [id]),
    db.query('SELECT area, score FROM area_progress WHERE student_language_id=$1', [id]),
    db.query(`SELECT error_type, expected, actual, frequency FROM student_errors WHERE student_language_id=$1 AND NOT resolved
                AND (last_seen AT TIME ZONE 'America/Sao_Paulo')::date >= ${since} ORDER BY frequency DESC, last_seen DESC LIMIT 5`, [id]),
    db.query(`SELECT count(DISTINCT (created_at AT TIME ZONE 'America/Sao_Paulo')::date)::int AS n FROM xp_events
              WHERE student_language_id=$1 AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date >= ${since}`, [id]),
  ]);

  const byMode = Object.fromEntries(lessonsQ.rows.map((r) => [r.mode, r]));
  const pron = Object.fromEntries(pronQ.rows.map((r) => [r.kind, r]));
  const lessonMinutes = lessonsQ.rows.reduce((s, r) => s + r.minutes, 0);
  const extraMinutes = vocabQ.rows[0].reviews * MINUTES_PER.flashcard + (pron.shadowing?.n || 0) * MINUTES_PER.shadowing + (pron.listening?.n || 0) * MINUTES_PER.listening;
  const start = Object.fromEntries(histQ.rows.map((r) => [r.area, r.score]));
  const now = Object.fromEntries(areasQ.rows.map((r) => [r.area, r.score]));
  const areas = AREAS.map((a) => ({ area: a, now: now[a] ?? 0, delta: (now[a] ?? 0) - (start[a] ?? 0) }));

  const [skills, errors] = await Promise.all([students.loadSkills(id), students.loadOpenErrors(id)]);
  const nextFocus = engine.getStudentWeaknesses(skills, errors, student.level).slice(0, 3).map((s) => s.name);
  const weakestArea = areas.filter((a) => a.area !== 'grammar').sort((a, b) => a.now - b.now)[0];

  const count = (...modes) => modes.reduce((s, m) => s + (byMode[m]?.n || 0), 0);
  return {
    period: { days: 7 },
    minutes: Math.round(lessonMinutes + extraMinutes),
    activeDays: daysQ.rows[0].n,
    xp: xpQ.rows[0].xp,
    lessons: count('lesson', 'daily', 'words', 'material'),
    conversations: count('conversation', 'live'),
    liveSessions: count('live'),
    roleplays: count('roleplay'),
    words: { added: vocabQ.rows[0].added, reviewed: vocabQ.rows[0].reviewed_words, reviews: vocabQ.rows[0].reviews },
    errorsCorrected: errorsQ.rows[0].n,
    pronunciation: pron.shadowing || null,
    listening: pron.listening || null,
    areas,
    difficulties: topErrQ.rows.map((e) => ({ type: e.error_type, actual: e.actual, expected: e.expected, frequency: e.frequency })),
    nextWeek: { skills: nextFocus, area: weakestArea?.area || null },
  };
}

module.exports = { goals, achievements, weekly };
