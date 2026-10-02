// Atualizações de progresso compartilhadas por todos os modos (aula, conversa, vocabulário, pronúncia…)
const config = require('../config');
const { LEVELS } = require('../languages');
const { updateArea } = require('./pedagogy/mastery');
const srs = require('./pedagogy/srs');
const engine = require('./pedagogy/engine');
const { newAchievements } = require('./pedagogy/gamification');

const TODAY = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;
const VOCAB_ERRORS = /SPELLING|VOCAB|WORD_CHOICE|WRONG_WORD/;
// Erros de "conteúdo" não vão para a memória de erros recorrentes
const NON_LINGUISTIC = /TARGET|MISSING|CONTENT|RELEVAN|OFF_TOPIC|TASK|QUESTION/;

async function addXp(c, slId, amount, reason) {
  if (!amount) return;
  await c.query('UPDATE student_languages SET xp = xp + $2 WHERE id=$1', [slId, amount]);
  await c.query('INSERT INTO xp_events(student_language_id, amount, reason) VALUES ($1,$2,$3)', [slId, amount, reason]);
}

async function bumpArea(c, slId, area, success, weight) {
  const { rows: [r] } = await c.query('SELECT score FROM area_progress WHERE student_language_id=$1 AND area=$2 FOR UPDATE', [slId, area]);
  const score = updateArea(r?.score ?? 0, success, weight);
  await c.query(
    `INSERT INTO area_progress(student_language_id, area, score) VALUES ($1,$2,$3)
     ON CONFLICT (student_language_id, area) DO UPDATE SET score = EXCLUDED.score`, [slId, area, score]);
  await c.query(
    `INSERT INTO area_history(student_language_id, day, area, score) VALUES ($1, ${TODAY}, $2, $3)
     ON CONFLICT (student_language_id, day, area) DO UPDATE SET score = EXCLUDED.score`, [slId, area, score]);
}

/** Registra erros linguísticos na memória do aluno (frequência + revisão espaçada) */
async function recordErrors(c, slId, skillId, errors, skillByCode = {}, { source = 'lesson', lessonId = null } = {}) {
  const { intervalDays, nextReview } = srs.nextReview(0, false);
  for (const e of errors.filter((x) => !NON_LINGUISTIC.test(x.type) && x.severity !== 'typo')) {
    const severity = e.severity === 'critical' ? 'critical' : e.severity === 'minor' ? 'low' : 'medium';
    await c.query(
      `INSERT INTO student_errors(student_language_id, skill_id, error_type, expected, actual, severity, next_review, srs_interval_days, source, source_lesson_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (student_language_id, error_type, expected, actual) DO UPDATE SET
         frequency = student_errors.frequency + 1, last_seen = now(), resolved = false,
         severity = EXCLUDED.severity, next_review = EXCLUDED.next_review, srs_interval_days = EXCLUDED.srs_interval_days,
         source = EXCLUDED.source, source_lesson_id = EXCLUDED.source_lesson_id`,
      [slId, skillByCode[e.type] ?? skillId, e.type, e.corrected.slice(0, 200), e.original.slice(0, 200), severity, nextReview, intervalDays, source, lessonId]);
  }
}

async function addVocabulary(c, slId, words, level) {
  for (const v of words) {
    await c.query(
      `INSERT INTO vocabulary(student_language_id, word, translation, level, next_review, srs_interval_days)
       VALUES ($1,$2,$3,$4, now() + interval '1 day', 1) ON CONFLICT (student_language_id, word) DO NOTHING`,
      [slId, v.word.toLowerCase().trim(), v.translation, level]);
  }
}

/** Revisão espaçada de uma palavra (flashcard ou item de aula) */
async function reviewVocab(c, slId, vocabId, success) {
  const { rows: [v] } = await c.query('SELECT * FROM vocabulary WHERE id=$1 AND student_language_id=$2 FOR UPDATE', [vocabId, slId]);
  if (!v) return null;
  const r = srs.nextReview(v.srs_interval_days, success);
  // palavra "graduada" continua no vocabulário, revisada a cada 60 dias
  const next = r.graduated ? new Date(Date.now() + 60 * 86400000) : r.nextReview;
  const mastery = Math.max(0, Math.min(100, v.mastery + (success ? 20 : -15)));
  const { rows: [updated] } = await c.query(
    `UPDATE vocabulary SET srs_interval_days=$2, next_review=$3, last_review=now(), mastery=$4, mistakes = mistakes + $5
     WHERE id=$1 RETURNING *`, [vocabId, r.intervalDays, next, mastery, success ? 0 : 1]);
  await c.query('INSERT INTO vocab_reviews(student_language_id, vocab_id, success) VALUES ($1,$2,$3)', [slId, vocabId, success]);
  return updated;
}

async function reviewError(c, errorId, success) {
  const { rows: [e] } = await c.query('SELECT * FROM student_errors WHERE id=$1 FOR UPDATE', [errorId]);
  if (!e) return;
  const r = srs.nextReview(success ? e.srs_interval_days : 0, success);
  await c.query('UPDATE student_errors SET srs_interval_days=$2, next_review=$3, resolved=$4 WHERE id=$1',
    [errorId, r.intervalDays, r.nextReview, r.graduated]);
}

/** Marca o dia como estudado (sequência no fuso de Brasília) */
async function markStudied(c, slId) {
  await c.query(
    `UPDATE student_languages SET
       streak_days = CASE WHEN last_study_date = ${TODAY} THEN streak_days
                          WHEN last_study_date = ${TODAY} - 1 THEN streak_days + 1 ELSE 1 END,
       last_study_date = ${TODAY}
     WHERE id=$1`, [slId]);
}

async function maybeLevelUp(c, slId, level, loadSkills) {
  const skills = await loadSkills(slId, c);
  if (!engine.shouldLevelUp(skills, level)) return null;
  const next = LEVELS[LEVELS.indexOf(level) + 1];
  await c.query('UPDATE student_languages SET level=$2 WHERE id=$1', [slId, next]);
  return next;
}

/** Guarda fatos sobre o aluno (sem repetir) e o resumo da conversa. Mantém os 60 mais recentes. */
async function saveMemories(c, slId, lessonId, { facts = [], summary }) {
  for (const f of facts.map((x) => String(x).trim()).filter(Boolean).slice(0, 6)) {
    const { rowCount } = await c.query(`SELECT 1 FROM student_memories WHERE student_language_id=$1 AND kind='fact' AND lower(content)=lower($2)`, [slId, f]);
    if (!rowCount) await c.query(`INSERT INTO student_memories(student_language_id, kind, content, lesson_id) VALUES ($1,'fact',$2,$3)`, [slId, f.slice(0, 300), lessonId]);
  }
  if (summary) await c.query(`INSERT INTO student_memories(student_language_id, kind, content, lesson_id) VALUES ($1,'session',$2,$3)`, [slId, String(summary).slice(0, 500), lessonId]);
  await c.query(`DELETE FROM student_memories WHERE student_language_id=$1 AND id NOT IN (SELECT id FROM student_memories WHERE student_language_id=$1 ORDER BY id DESC LIMIT 60)`, [slId]);
}

/** O que o professor lembra do aluno: fatos recentes + resumo das últimas conversas */
async function loadMemories(slId, client) {
  const { rows } = await client.query(
    `SELECT kind, content, created_at FROM student_memories WHERE student_language_id=$1 ORDER BY id DESC LIMIT 30`, [slId]);
  const date = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
  return {
    facts: rows.filter((r) => r.kind === 'fact').slice(0, 15).map((r) => r.content),
    sessions: rows.filter((r) => r.kind === 'session').slice(0, 3).map((r) => `${date(r.created_at)}: ${r.content}`),
  };
}

async function achievementStats(c, slId) {
  const { rows: [s] } = await c.query(
    `SELECT
       (SELECT streak_days FROM student_languages WHERE id=$1) AS streak,
       (SELECT count(*) FROM lessons WHERE student_language_id=$1 AND state='LESSON_COMPLETED' AND mode IN ('lesson','daily','material','words'))::int AS lessons,
       (SELECT count(*) FROM lessons WHERE student_language_id=$1 AND state='LESSON_COMPLETED' AND mode IN ('conversation','live'))::int AS conversations,
       (SELECT count(*) FROM lessons WHERE student_language_id=$1 AND state='LESSON_COMPLETED' AND mode='roleplay')::int AS roleplays,
       (SELECT COALESCE(sum(LEAST(EXTRACT(EPOCH FROM (completed_at - started_at))/60, 45)),0) FROM lessons
          WHERE student_language_id=$1 AND state='LESSON_COMPLETED' AND mode IN ('conversation','roleplay','live'))::int AS "conversationMinutes",
       (SELECT count(*) FROM vocabulary WHERE student_language_id=$1)::int AS words,
       (SELECT count(*) FROM vocab_reviews WHERE student_language_id=$1)::int AS "vocabReviews",
       (SELECT count(*) FROM pronunciation_attempts WHERE student_language_id=$1 AND kind='shadowing')::int AS shadowings,
       (SELECT COALESCE(max(score),0) FROM pronunciation_attempts WHERE student_language_id=$1 AND kind='shadowing')::int AS "bestPronunciation",
       (SELECT count(*) FROM lessons WHERE student_language_id=$1 AND mode IN ('lesson','daily','words','material') AND (summary->>'accuracy')::int = 100)::int AS "perfectLessons",
       (SELECT count(*) FROM skill_mastery WHERE student_language_id=$1 AND score >= $2)::int AS "masteredSkills"`,
    [slId, config.pedagogy.masteredThreshold]);
  return s;
}

/** Verifica e grava conquistas novas. Retorna a lista das recém-desbloqueadas. */
async function checkAchievements(c, slId) {
  const stats = await achievementStats(c, slId);
  const { rows } = await c.query('SELECT code FROM student_achievements WHERE student_language_id=$1', [slId]);
  const fresh = newAchievements(stats, rows.map((r) => r.code));
  for (const a of fresh) {
    await c.query('INSERT INTO student_achievements(student_language_id, code) VALUES ($1,$2) ON CONFLICT DO NOTHING', [slId, a.code]);
  }
  return fresh.map(({ code, icon, name, desc }) => ({ code, icon, name, desc }));
}

module.exports = {
  TODAY, VOCAB_ERRORS, NON_LINGUISTIC,
  saveMemories, loadMemories,
  addXp, bumpArea, recordErrors, addVocabulary, reviewVocab, reviewError, markStudied, maybeLevelUp, checkAchievements,
};
