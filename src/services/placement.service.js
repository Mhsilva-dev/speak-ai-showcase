// Teste de nivelamento: a IA gera e corrige as perguntas; o backend escolhe a próxima e decide o nível.
const config = require('../config');
const db = require('../db/pool');
const teacher = require('./ai/teacher.service');
const placement = require('./pedagogy/placement');
const progress = require('./progress.service');
const students = require('./student.service');
const { LEVELS } = require('../languages');

const { HttpError } = students;

function view(t) {
  const q = t.current && !t.completed_at ? t.bank[t.current.bankIndex] : null;
  return {
    id: t.id,
    completed: !!t.completed_at,
    answered: t.asked.length,
    total: placement.TOTAL_QUESTIONS,
    question: q && { prompt: q.prompt, instructionPt: q.instructionPt, area: q.area },
    lastFeedback: t.asked.at(-1)?.feedbackPt || null,
    result: t.result,
  };
}

async function start(userId, slug) {
  const lang = students.resolveLanguage(slug);
  const { rows: [language] } = await db.query('SELECT id FROM languages WHERE slug=$1', [lang.slug]);
  // Retoma teste em andamento (de menos de 1 dia)
  const { rows: [open] } = await db.query(
    `SELECT * FROM placement_tests WHERE user_id=$1 AND language_id=$2 AND completed_at IS NULL AND created_at > now() - interval '1 day'
     ORDER BY id DESC LIMIT 1`, [userId, language.id]);
  if (open) return view(open);

  const { questions } = await teacher.placementBank({ lang })
    .catch(() => { throw new HttpError(503, 'O professor está indisponível no momento. Tente de novo em instantes.'); });
  const first = placement.nextQuestion(questions, []);
  const { rows: [t] } = await db.query(
    'INSERT INTO placement_tests(user_id, language_id, bank, current) VALUES ($1,$2,$3,$4) RETURNING *',
    [userId, language.id, JSON.stringify(questions), first]);
  return view(t);
}

async function answer(userId, testId, rawAnswer) {
  const text = String(rawAnswer || '').trim().slice(0, 1500);
  const { rows: [t] } = await db.query('SELECT p.*, l.slug FROM placement_tests p JOIN languages l ON l.id=p.language_id WHERE p.id=$1 AND p.user_id=$2', [testId, userId]);
  if (!t) throw new HttpError(404, 'Teste não encontrado');
  if (t.completed_at) return view(t);
  const lang = students.resolveLanguage(t.slug);
  const q = t.bank[t.current.bankIndex];

  let ev = { score: 0, feedbackPt: 'Sem problema — vamos para a próxima.' };
  if (text && !/^(n[aã]o sei|idk|\?+|-+)$/i.test(text)) {
    ev = await teacher.placementEval({ lang, question: q, answer: text })
      .catch(() => { throw new HttpError(503, 'Não consegui corrigir agora. Envie de novo em instantes.'); });
  }

  const asked = [...t.asked, { bankIndex: t.current.bankIndex, level: q.level, area: q.area, score: Math.round(ev.score), feedbackPt: ev.feedbackPt }];
  const next = placement.nextQuestion(t.bank, asked);
  let result = null;
  if (!next) result = placement.estimate(asked);

  const { rows: [updated] } = await db.query(
    `UPDATE placement_tests SET asked=$2, current=$3, result=$4, completed_at = CASE WHEN $4::jsonb IS NULL THEN NULL ELSE now() END
     WHERE id=$1 AND completed_at IS NULL RETURNING *`,
    [testId, JSON.stringify(asked), next, result]);
  if (!updated) throw new HttpError(409, 'Teste já concluído');

  // Aluno já matriculado: aplica o nível estimado (pode subir ou descer)
  if (result) {
    const { student } = await students.getStudentLanguage(userId, t.slug);
    if (student) await applyResult(student, result);
  }
  return view(updated);
}

async function applyResult(student, result) {
  await db.tx(async (c) => {
    await c.query('UPDATE student_languages SET level=$2, placement=$3 WHERE id=$1', [student.id, result.level, result]);
    // Habilidades de níveis abaixo do estimado contam como parcialmente conhecidas
    await c.query(
      `UPDATE skill_mastery m SET score = GREATEST(m.score, 70) FROM skills s
       WHERE m.skill_id = s.id AND m.student_language_id = $1
         AND array_position($2::text[], s.cefr_level) < array_position($2::text[], $3)`, [student.id, LEVELS, result.level]);
    await progress.addXp(c, student.id, config.pedagogy.xp.placement, 'placement');
  });
}

async function latestResult(userId, slug) {
  const lang = students.resolveLanguage(slug);
  const { rows: [t] } = await db.query(
    `SELECT p.result FROM placement_tests p JOIN languages l ON l.id=p.language_id
     WHERE p.user_id=$1 AND l.slug=$2 AND p.completed_at IS NOT NULL ORDER BY p.id DESC LIMIT 1`, [userId, lang.slug]);
  return t?.result || null;
}

module.exports = { start, answer, latestResult };
