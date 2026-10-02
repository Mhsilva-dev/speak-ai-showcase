// Vocabulário do aluno + flashcards com repetição espaçada
const config = require('../config');
const db = require('../db/pool');
const teacher = require('./ai/teacher.service');
const progress = require('./progress.service');
const students = require('./student.service');

const { HttpError } = students;
const FIELDS = 'id, word, translation, meaning, examples, level, pronunciation, mastery, mistakes, difficult, srs_interval_days, last_review, next_review, created_at';

async function list(userId, slug, { filter = 'all', q } = {}) {
  const { student } = await students.requireStudentLanguage(userId, slug);
  const where = ['student_language_id=$1'];
  const params = [student.id];
  if (filter === 'due') where.push('next_review <= now()');
  if (filter === 'difficult') where.push('(difficult OR mistakes >= 2)');
  if (q) { params.push(`%${String(q).slice(0, 60)}%`); where.push(`(word ILIKE $${params.length} OR translation ILIKE $${params.length})`); }
  const { rows } = await db.query(`SELECT ${FIELDS} FROM vocabulary WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 500`, params);
  const { rows: [counts] } = await db.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE next_review <= now())::int AS due,
            count(*) FILTER (WHERE difficult OR mistakes >= 2)::int AS difficult, count(*) FILTER (WHERE mastery >= 80)::int AS mastered
     FROM vocabulary WHERE student_language_id=$1`, [student.id]);
  return { words: rows, counts };
}

async function add(userId, slug, rawWord, known = {}) {
  const { lang, student } = await students.requireStudentLanguage(userId, slug);
  const word = String(rawWord || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!word) throw new HttpError(400, 'Digite uma palavra');
  let info = { word, translation: null, meaning: null, examples: [], pronunciation: null, level: null };
  if (known.translation) info = { ...info, translation: String(known.translation).slice(0, 160), pronunciation: known.pronunciation ? String(known.pronunciation).slice(0, 120) : null, meaning: known.meaning ? String(known.meaning).slice(0, 300) : null };
  else { try { info = await teacher.enrichWord({ lang, student, word, level: student.level }); } catch { /* salva só a palavra */ } }
  const { rows: [v] } = await db.query(
    `INSERT INTO vocabulary(student_language_id, word, translation, meaning, examples, pronunciation, level, next_review, srs_interval_days)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now(), 0)
     ON CONFLICT (student_language_id, word) DO UPDATE SET
       translation = COALESCE(EXCLUDED.translation, vocabulary.translation), meaning = COALESCE(EXCLUDED.meaning, vocabulary.meaning),
       examples = CASE WHEN jsonb_array_length(EXCLUDED.examples) > 0 THEN EXCLUDED.examples ELSE vocabulary.examples END,
       pronunciation = COALESCE(EXCLUDED.pronunciation, vocabulary.pronunciation)
     RETURNING ${FIELDS}`,
    [student.id, info.word.toLowerCase(), info.translation, info.meaning, JSON.stringify(info.examples || []), info.pronunciation, info.level]);
  await db.tx((c) => progress.checkAchievements(c, student.id));
  return v;
}

async function update(userId, slug, id, { difficult }) {
  const { student } = await students.requireStudentLanguage(userId, slug);
  const { rows: [v] } = await db.query(
    `UPDATE vocabulary SET difficult=$3, next_review = CASE WHEN $3 THEN LEAST(next_review, now()) ELSE next_review END
     WHERE id=$1 AND student_language_id=$2 RETURNING ${FIELDS}`, [id, student.id, !!difficult]);
  if (!v) throw new HttpError(404, 'Palavra não encontrada');
  return v;
}

async function remove(userId, slug, id) {
  const { student } = await students.requireStudentLanguage(userId, slug);
  const { rowCount } = await db.query('DELETE FROM vocabulary WHERE id=$1 AND student_language_id=$2', [id, student.id]);
  if (!rowCount) throw new HttpError(404, 'Palavra não encontrada');
  return { ok: true };
}

/** Fila de revisão: vencidas primeiro, depois as difíceis */
async function reviewQueue(userId, slug) {
  const { student } = await students.requireStudentLanguage(userId, slug);
  const { rows } = await db.query(
    `SELECT ${FIELDS} FROM vocabulary WHERE student_language_id=$1 AND next_review <= now()
     ORDER BY difficult DESC, mistakes DESC, next_review LIMIT 20`, [student.id]);
  return { cards: rows };
}

async function review(userId, slug, id, success) {
  const { student } = await students.requireStudentLanguage(userId, slug);
  return db.tx(async (c) => {
    const v = await progress.reviewVocab(c, student.id, id, !!success);
    if (!v) throw new HttpError(404, 'Palavra não encontrada');
    await progress.bumpArea(c, student.id, 'vocabulary', !!success, 0.05);
    await progress.addXp(c, student.id, success ? config.pedagogy.xp.flashcard : 1, 'flashcard');
    await progress.markStudied(c, student.id);
    const achievements = await progress.checkAchievements(c, student.id);
    return { word: v, achievements };
  });
}

module.exports = { list, add, update, remove, reviewQueue, review };
