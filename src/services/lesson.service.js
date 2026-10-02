// Aulas estruturadas (lesson | daily | words | material): motor pedagógico decide, IA fala, banco lembra.
const config = require('../config');
const db = require('../db/pool');
const { TOPICS } = require('../languages');
const SCENARIOS = require('../languages/scenarios');
const { getTeacher } = require('../languages/teachers');
const teacher = require('./ai/teacher.service');
const engine = require('./pedagogy/engine');
const { S, walk } = require('./pedagogy/stateMachine');
const { calculateMastery } = require('./pedagogy/mastery');
const progress = require('./progress.service');
const students = require('./student.service');

const { HttpError } = students;
const STRUCTURED = ['lesson', 'daily', 'words', 'material'];

async function addMessage(c, lessonId, role, kind, content, payload = null) {
  await c.query('INSERT INTO messages(lesson_id, role, kind, content, payload) VALUES ($1,$2,$3,$4,$5)',
    [lessonId, role, kind, content, payload]);
}

async function askItem(c, lessonId, item, total) {
  await addMessage(c, lessonId, 'teacher', 'question', item.prompt,
    { instructionPt: item.instruction_pt, itemIndex: item.order_index, total, difficulty: item.difficulty, review: item.vocab_id ? 'vocab' : item.error_id ? 'error' : null });
}

async function loadLessonFor(userId, lessonId, client = db, lock = false) {
  const { rows } = await client.query(
    `SELECT l.*, sl.user_id, sl.level, sl.goal, sl.teaching_style, sl.interests, sl.teacher_voice, sl.id AS sl_id, lang.slug, lang.code AS lang_code
     FROM lessons l JOIN student_languages sl ON sl.id = l.student_language_id JOIN languages lang ON lang.id = sl.language_id
     WHERE l.id = $1 ${lock ? 'FOR UPDATE OF l' : ''}`, [lessonId]);
  const lesson = rows[0];
  if (!lesson || lesson.user_id !== userId) throw new HttpError(404, 'Aula não encontrada');
  return lesson;
}

/** Atividade em andamento de um grupo de modos. Aulas escritas, conversa por texto e voz ao vivo não bloqueiam umas às outras. */
async function activeLessonId(slId, modes = STRUCTURED) {
  const { rows } = await db.query(
    `SELECT id FROM lessons WHERE student_language_id=$1 AND state <> 'LESSON_COMPLETED' AND mode = ANY($2) ORDER BY id DESC LIMIT 1`, [slId, modes]);
  return rows[0]?.id || null;
}

const aiDown = () => new HttpError(503, 'O professor está indisponível no momento. Tente de novo em instantes.');

/** Cria a aula com os itens já planejados e faz a primeira pergunta */
async function createStructuredLesson({ slId, mode, skillId, topic, difficulty, reviewErrorIds = [], materialId = null, aiPlan, refs = {} }) {
  return db.tx(async (c) => {
    const { state } = walk(S.LESSON_STARTED, S.INTRODUCTION, S.PRACTICE, S.WAITING_FOR_ANSWER);
    const { rows: [lesson] } = await c.query(
      `INSERT INTO lessons(student_language_id, skill_id, topic, state, difficulty, review_error_ids, mode, material_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [slId, skillId, topic, state, difficulty, reviewErrorIds, mode, materialId]);
    for (const [i, it] of aiPlan.items.entries()) {
      const [kind, id] = String(it.ref || '').split(':');
      const vocabId = kind === 'vocab' && refs.vocab?.has(Number(id)) ? Number(id) : null;
      const errorId = kind === 'error' && refs.error?.has(Number(id)) ? Number(id) : null;
      await c.query(
        `INSERT INTO lesson_items(lesson_id, order_index, prompt, instruction_pt, model_answer, difficulty, vocab_id, error_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [lesson.id, i, it.prompt, it.instructionPt, it.modelAnswer, it.difficulty, vocabId, errorId]);
    }
    await addMessage(c, lesson.id, 'teacher', 'intro', aiPlan.introTarget, { pt: aiPlan.introPt, mode, topic });
    const first = (await c.query('SELECT * FROM lesson_items WHERE lesson_id=$1 AND order_index=0', [lesson.id])).rows[0];
    await askItem(c, lesson.id, first, aiPlan.items.length);
    return lesson.id;
  });
}

/**
 * mode: lesson (foco do dia) | daily (minha aula de hoje) | words (palavras escolhidas)
 */
async function startLesson(userId, slug, { topic, mode = 'lesson', wordIds } = {}) {
  const { lang, student } = await students.requireStudentLanguage(userId, slug);
  if (!['lesson', 'daily', 'words'].includes(mode)) throw new HttpError(400, 'Modo inválido');

  // Uma atividade por vez: o aluno não pula aulas
  const active = await activeLessonId(student.id);
  if (active) return getLesson(userId, active);

  if (topic && topic !== 'surprise' && !TOPICS.includes(topic)) throw new HttpError(400, 'Tema inválido');
  const [skills, errors, topics] = await Promise.all([
    students.loadSkills(student.id), students.loadOpenErrors(student.id), students.recentTopics(student.id),
  ]);
  const chosenTopic = topic === 'surprise' ? null : topic;

  if (mode === 'lesson') {
    const plan = engine.getNextLesson({ skills, errors, student, recentTopics: topics, topic: chosenTopic });
    if (!plan) throw new HttpError(409, 'Nenhuma habilidade disponível');
    const count = config.pedagogy.itemsPerLesson;
    const aiPlan = await teacher.generateLessonPlan({ lang, student, skill: plan.skill, topic: plan.topic, difficulty: plan.difficulty, count, reviewErrors: plan.reviewErrors })
      .catch(() => { throw aiDown(); });
    aiPlan.items = aiPlan.items.slice(0, count);
    const id = await createStructuredLesson({
      slId: student.id, mode, skillId: plan.skill.id, topic: plan.topic, difficulty: plan.difficulty,
      reviewErrorIds: plan.reviewErrors.map((e) => e.id), aiPlan,
    });
    return getLesson(userId, id);
  }

  let words;
  if (mode === 'words') {
    const ids = (Array.isArray(wordIds) ? wordIds : []).map(Number).filter(Number.isInteger).slice(0, 8);
    if (!ids.length) throw new HttpError(400, 'Escolha as palavras');
    ({ rows: words } = await db.query('SELECT * FROM vocabulary WHERE student_language_id=$1 AND id = ANY($2)', [student.id, ids]));
    if (!words.length) throw new HttpError(400, 'Palavras não encontradas');
  } else {
    ({ rows: words } = await db.query(
      'SELECT * FROM vocabulary WHERE student_language_id=$1 AND next_review <= now() ORDER BY next_review LIMIT 20', [student.id]));
  }

  const plan = mode === 'daily'
    ? engine.buildDailyPlan({ skills, errors, dueVocab: words, student, recentTopics: topics })
    : { ...engine.getNextLesson({ skills, errors, student, recentTopics: topics, topic: chosenTopic }), reviewErrors: [], words, skillCount: 0 };
  if (!plan?.skill) throw new HttpError(409, 'Nenhuma habilidade disponível');
  if (chosenTopic) plan.topic = chosenTopic;

  const aiPlan = await teacher.generateDailyPlan({
    lang, student, skill: plan.skill, topic: plan.topic, difficulty: plan.difficulty,
    reviewErrors: plan.reviewErrors, words: plan.words, skillCount: plan.skillCount,
    focusPt: mode === 'daily' ? '"Minha aula de hoje": revisão + prática personalizada' : 'uma aula focada nas palavras que o aluno escolheu estudar hoje',
  }).catch(() => { throw aiDown(); });
  aiPlan.items = aiPlan.items.slice(0, 10);
  const id = await createStructuredLesson({
    slId: student.id, mode, skillId: plan.skill.id, topic: plan.topic, difficulty: plan.difficulty,
    reviewErrorIds: plan.reviewErrors.map((e) => e.id), aiPlan,
    refs: { vocab: new Set(plan.words.map((w) => w.id)), error: new Set(plan.reviewErrors.map((e) => e.id)) },
  });
  return getLesson(userId, id);
}

/** Aula a partir dos exercícios extraídos de uma foto/PDF */
async function startMaterialLesson(userId, slug, materialId) {
  const { student } = await students.requireStudentLanguage(userId, slug);
  const active = await activeLessonId(student.id);
  if (active) return getLesson(userId, active);
  const { rows: [m] } = await db.query('SELECT * FROM materials WHERE id=$1 AND student_language_id=$2', [materialId, student.id]);
  if (!m) throw new HttpError(404, 'Material não encontrado');
  const a = m.analysis;
  if (!a?.exercises?.length) throw new HttpError(409, 'Não encontrei exercícios neste material');
  const skills = await students.loadSkills(student.id);
  const skill = skills.find((s) => s.code === a.skillCode) || engine.getStudentWeaknesses(skills, [], student.level)[0];
  const aiPlan = {
    introTarget: a.titlePt,
    introPt: `Vamos resolver juntos os exercícios do seu material. ${a.summaryPt}`,
    items: a.exercises.map((e) => ({
      prompt: e.options?.length ? `${e.question}\n${e.options.map((o, i) => `${String.fromCharCode(97 + i)}) ${o}`).join('\n')}` : e.question,
      instructionPt: e.instruction || null,
      modelAnswer: e.answer,
      difficulty: 2,
    })),
  };
  const id = await createStructuredLesson({ slId: student.id, mode: 'material', skillId: skill.id, topic: a.titlePt.slice(0, 80), difficulty: 2, materialId: m.id, aiPlan });
  return getLesson(userId, id);
}

async function getLesson(userId, lessonId) {
  const lesson = await loadLessonFor(userId, lessonId);
  const [{ rows: messages }, { rows: items }, { rows: [skill] }] = await Promise.all([
    db.query('SELECT id, role, kind, content, payload, created_at FROM messages WHERE lesson_id=$1 ORDER BY id', [lessonId]),
    db.query('SELECT order_index, status, attempts FROM lesson_items WHERE lesson_id=$1 ORDER BY order_index', [lessonId]),
    db.query('SELECT code, name, cefr_level FROM skills WHERE id=$1', [lesson.skill_id]),
  ]);
  const scenario = SCENARIOS.find((s) => s.id === lesson.scenario);
  return {
    id: lesson.id,
    language: lesson.slug,
    mode: lesson.mode,
    state: lesson.state,
    topic: lesson.topic,
    scenario: scenario ? { id: scenario.id, namePt: scenario.namePt, emoji: scenario.emoji, goalPt: scenario.goalPt } : null,
    difficulty: lesson.difficulty,
    skill: skill || null,
    currentItem: lesson.current_item,
    turns: lesson.turns,
    targetTurns: lesson.target_turns,
    teacherVoice: getTeacher(lesson.teacher_voice, lesson.lang_code).voice,
    items,
    messages: messages.map((m) => (m.payload?.filePath ? { ...m, payload: { ...m.payload, filePath: undefined } } : m)),
    summary: lesson.summary,
    completed: lesson.state === S.LESSON_COMPLETED,
  };
}

async function submitAnswer(userId, lessonId, rawAnswer) {
  const answer = String(rawAnswer || '').trim().slice(0, 1000);
  if (!answer) throw new HttpError(400, 'Resposta vazia');

  const lesson = await loadLessonFor(userId, lessonId);
  if (!STRUCTURED.includes(lesson.mode)) throw new HttpError(400, 'Use o endpoint de conversa');
  // Trava otimista: só uma avaliação por vez (evita duplo envio)
  const { rowCount } = await db.query(`UPDATE lessons SET state=$2 WHERE id=$1 AND state=$3`, [lessonId, S.EVALUATING, S.WAITING_FOR_ANSWER]);
  if (!rowCount) throw new HttpError(409, lesson.state === S.LESSON_COMPLETED ? 'Aula já concluída' : 'Aguarde a avaliação anterior');

  const { lang, student } = await students.requireStudentLanguage(userId, lesson.slug);
  const { rows: [item] } = await db.query('SELECT * FROM lesson_items WHERE lesson_id=$1 AND order_index=$2', [lessonId, lesson.current_item]);
  const { rows: [skill] } = await db.query('SELECT * FROM skills WHERE id=$1', [lesson.skill_id]);

  let evaluation;
  try {
    evaluation = await teacher.evaluateAnswer({ lang, student, skill, item, answer, attempt: item.attempts + 1 });
  } catch (err) {
    await db.query('UPDATE lessons SET state=$2 WHERE id=$1', [lessonId, S.WAITING_FOR_ANSWER]);
    throw new HttpError(503, 'Não consegui avaliar sua resposta agora. Envie de novo em instantes.');
  }

  evaluation = engine.sanitizeEvaluation(evaluation, answer);
  const style = student.teaching_style;
  const failedBefore = item.hints_used; // hints_used = erros já cometidos neste item (nível de dica liberado)
  const decision = engine.decideAfterEvaluation({ evaluation, failedAttempts: failedBefore, style });
  const shown = engine.errorsToShow(evaluation.errors, style);
  const total = (await db.query('SELECT count(*)::int AS n FROM lesson_items WHERE lesson_id=$1', [lessonId])).rows[0].n;

  let completed = false;
  await db.tx(async (c) => {
    const L = await loadLessonFor(userId, lessonId, c, true);
    await addMessage(c, lessonId, 'student', 'answer', answer);

    if (decision.action === 'OFF_TOPIC') {
      walk(S.EVALUATING, S.WAITING_FOR_ANSWER);
      await addMessage(c, lessonId, 'teacher', 'redirect', evaluation.redirectTarget || item.prompt);
      await c.query('UPDATE lessons SET state=$2 WHERE id=$1', [lessonId, S.WAITING_FOR_ANSWER]);
      return;
    }

    await c.query('UPDATE lesson_items SET attempts = attempts + 1 WHERE id=$1', [item.id]);
    await progress.addVocabulary(c, L.sl_id, evaluation.newVocabulary, student.level);
    await progress.bumpArea(c, L.sl_id, 'vocabulary', !evaluation.errors.some((e) => progress.VOCAB_ERRORS.test(e.type) && e.severity !== 'typo'));

    if (decision.action === 'CORRECT') {
      const recent = (await c.query(`SELECT payload->>'praise' AS p FROM messages WHERE lesson_id=$1 AND kind='correct' ORDER BY id DESC LIMIT 3`, [lessonId])).rows.map((r) => r.p);
      const minor = shown.filter((e) => ['minor', 'relevant'].includes(e.severity));
      if (minor.length) await progress.recordErrors(c, L.sl_id, L.skill_id, minor); // registrado para revisão, sem travar a conversa
      await addMessage(c, lessonId, 'teacher', 'correct', evaluation.feedbackTarget, {
        praise: engine.praise(lang, recent), notes: minor, correctedSentence: minor.length ? evaluation.correctedSentence : null,
        phonetic: evaluation.phonetic,
      });
      await finishItem(c, { L, item, skill, style, outcome: 'correct', failedAttempts: failedBefore, total });
    } else {
      if (failedBefore === 0) {
        const blocking = engine.blockingErrors(evaluation.errors, style);
        await progress.recordErrors(c, L.sl_id, L.skill_id, blocking.length ? blocking : shown);
      }
      await c.query('UPDATE lesson_items SET hints_used = $2 WHERE id=$1', [item.id, decision.failedAttempts]);
      const r = decision.reveal;
      const full = evaluation.correctedSentence || item.model_answer;
      await addMessage(c, lessonId, 'teacher', 'correction', evaluation.feedbackTarget, {
        stage: decision.action,
        attempt: decision.failedAttempts,
        errors: shown,
        original: answer,
        explanationPt: r.explanation ? evaluation.explanationPt : r.alternative ? (evaluation.alternativeExplanationPt || evaluation.explanationPt) : null,
        hint: r.hint1 ? evaluation.hint1 : r.hint2 ? evaluation.hint2 : null,
        partial: r.partial ? evaluation.partialAnswer : null,
        corrected: r.full ? full : null,
        phonetic: r.full ? evaluation.phonetic : null,
        askRepeat: decision.action !== 'GIVE_UP',
      });
      if (decision.action === 'GIVE_UP') {
        await finishItem(c, { L, item, skill, style, outcome: 'failed', failedAttempts: decision.failedAttempts, total });
      } else {
        const { path } = walk(S.EVALUATING, S.INCORRECT, decision.action, S.WAITING_FOR_ANSWER);
        const diff = decision.action === 'DIFFICULTY_REDUCTION' ? Math.max(1, L.difficulty - 1) : L.difficulty;
        await c.query('UPDATE lessons SET state=$2, difficulty=$3, correct_streak=0 WHERE id=$1', [lessonId, path.at(-1), diff]);
      }
    }
    completed = (await c.query('SELECT state FROM lessons WHERE id=$1', [lessonId])).rows[0].state === S.LESSON_COMPLETED;
  });

  if (completed) await writeSummary(userId, lessonId, { lang, student, skill });
  return getLesson(userId, lessonId);
}

async function notifyAchievements(c, lessonId, slId) {
  for (const a of await progress.checkAchievements(c, slId)) {
    await addMessage(c, lessonId, 'teacher', 'achievement', `${a.icon} Conquista desbloqueada: ${a.name}`, a);
  }
}

/** Item encerrado (acerto ou desistência): atualiza domínio, áreas, SRS, XP, dificuldade e avança ou conclui. */
async function finishItem(c, { L, item, skill, style, outcome, failedAttempts, total }) {
  const correct = outcome === 'correct';
  const firstTry = correct && failedAttempts === 0;
  await c.query('UPDATE lesson_items SET status=$2 WHERE id=$1', [item.id, correct ? 'correct' : 'failed']);

  const { rows: [m] } = await c.query('SELECT score FROM skill_mastery WHERE student_language_id=$1 AND skill_id=$2 FOR UPDATE', [L.sl_id, skill.id]);
  const before = m?.score ?? 0;
  const after = calculateMastery(before, { correct, failedAttempts, difficulty: item.difficulty });
  await c.query(
    `UPDATE skill_mastery SET score=$3, attempts=attempts+1, correct=correct+$4, last_practiced=now()
     WHERE student_language_id=$1 AND skill_id=$2`, [L.sl_id, skill.id, after, correct ? 1 : 0]);
  await progress.bumpArea(c, L.sl_id, 'grammar', firstTry);
  await progress.bumpArea(c, L.sl_id, 'speaking', correct);

  // Itens de revisão alimentam a repetição espaçada da palavra/erro
  if (item.vocab_id) await progress.reviewVocab(c, L.sl_id, item.vocab_id, firstTry);
  if (item.error_id) await progress.reviewError(c, item.error_id, firstTry);

  const xp = correct ? (failedAttempts ? config.pedagogy.xp.correctAfterRetry : config.pedagogy.xp.correctFirstTry) : 0;
  await progress.addXp(c, L.sl_id, xp, 'item');

  const streak = firstTry ? L.correct_streak + 1 : 0;
  const adj = engine.adjustDifficulty({ difficulty: L.difficulty, correctStreak: streak, lastOutcome: correct ? 'correct' : 'failed', style });
  const steps = [correct ? S.CORRECT : S.INCORRECT];
  if (adj.changed === 'up') steps.push(S.DIFFICULTY_INCREASE);
  const mastered = before < config.pedagogy.masteredThreshold && after >= config.pedagogy.masteredThreshold;
  if (mastered) steps.push(S.MASTERED);

  if (adj.changed === 'up') await addMessage(c, L.id, 'teacher', 'notice', 'Você está indo muito bem — vou aumentar o desafio. 💪', { event: 'DIFFICULTY_INCREASE' });
  if (mastered) await addMessage(c, L.id, 'teacher', 'notice', `🏅 Você dominou ${skill.name}!`, { event: 'MASTERED' });

  if (engine.shouldAdvance({ itemIndex: L.current_item, totalItems: total })) {
    const { state } = walk(S.EVALUATING, ...steps, S.NEXT_ACTIVITY, S.PRACTICE, S.WAITING_FOR_ANSWER);
    const nextIdx = L.current_item + 1;
    await c.query('UPDATE lessons SET state=$2, current_item=$3, difficulty=$4, correct_streak=$5 WHERE id=$1', [L.id, state, nextIdx, adj.difficulty, streak]);
    const { rows: [next] } = await c.query('SELECT * FROM lesson_items WHERE lesson_id=$1 AND order_index=$2', [L.id, nextIdx]);
    await askItem(c, L.id, next, total);
  } else {
    const { state } = walk(S.EVALUATING, ...steps, S.LESSON_COMPLETED);
    await c.query('UPDATE lessons SET state=$2, difficulty=$3, correct_streak=$4, completed_at=now() WHERE id=$1', [L.id, state, adj.difficulty, streak]);
    await completeLesson(c, L);
  }
}

async function completeLesson(c, L) {
  const { rows: items } = await c.query('SELECT status, attempts, hints_used FROM lesson_items WHERE lesson_id=$1', [L.id]);
  const correct = items.filter((i) => i.status === 'correct').length;
  const firstTry = items.filter((i) => i.status === 'correct' && i.hints_used === 0).length;
  const { rows: corrections } = await c.query(`SELECT payload FROM messages WHERE lesson_id=$1 AND kind='correction'`, [L.id]);
  const seen = new Set();
  const lessonErrors = corrections.flatMap((m) => m.payload.errors || [])
    .filter((e) => !progress.NON_LINGUISTIC.test(e.type) && !seen.has(e.original + '|' + e.corrected) && seen.add(e.original + '|' + e.corrected));
  const { rows: [{ n: newVocab }] } = await c.query(
    'SELECT count(*)::int AS n FROM vocabulary WHERE student_language_id=$1 AND created_at >= (SELECT started_at FROM lessons WHERE id=$2)', [L.sl_id, L.id]);

  // Erros antigos revisados nesta aula (aula comum: avançam no SRS se não se repetiram)
  const repeated = new Set(lessonErrors.map((e) => e.type));
  if (L.mode === 'lesson') {
    for (const id of L.review_error_ids) {
      const { rows: [e] } = await c.query('SELECT error_type FROM student_errors WHERE id=$1', [id]);
      if (e && !repeated.has(e.error_type)) await progress.reviewError(c, id, true);
    }
  }

  await progress.markStudied(c, L.sl_id);
  await progress.addXp(c, L.sl_id, config.pedagogy.xp.lessonCompleted, `${L.mode}_completed`);
  const levelUp = await progress.maybeLevelUp(c, L.sl_id, L.level, students.loadSkills);

  const { rows: [sk] } = await c.query('SELECT score FROM skill_mastery WHERE student_language_id=$1 AND skill_id=$2', [L.sl_id, L.skill_id]);
  const summary = {
    total: items.length, correct, firstTry,
    accuracy: items.length ? Math.round((correct / items.length) * 100) : 0,
    errorsCorrected: lessonErrors.length,
    errors: lessonErrors.slice(0, 10),
    newVocabulary: newVocab,
    skillScore: sk?.score ?? 0,
    reviewTomorrow: [...repeated].slice(0, 3),
    levelUp,
  };
  await c.query('UPDATE lessons SET summary=$2 WHERE id=$1', [L.id, summary]);
  await notifyAchievements(c, L.id, L.sl_id);
}

async function writeSummary(userId, lessonId, { lang, student, skill }) {
  const lesson = await loadLessonFor(userId, lessonId);
  const s = lesson.summary;
  const { teacherCommentPt } = await teacher.summarizeLesson({ lang, student, skill, stats: s, errors: s.errors });
  const summary = { ...s, skill: skill.name, topic: lesson.topic, mode: lesson.mode, teacherComment: teacherCommentPt };
  await db.query('UPDATE lessons SET summary=$2 WHERE id=$1', [lessonId, summary]);
  await db.query(`INSERT INTO messages(lesson_id, role, kind, content, payload) VALUES ($1,'teacher','summary',$2,$3)`, [lessonId, teacherCommentPt, summary]);
}

module.exports = { startLesson, startMaterialLesson, getLesson, submitAnswer, loadLessonFor, addMessage, activeLessonId, notifyAchievements };
