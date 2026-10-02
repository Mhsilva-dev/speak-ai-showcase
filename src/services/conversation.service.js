// Conversa livre e roleplay: diálogo aberto, com o professor corrigindo sem travar a fluidez.
const config = require('../config');
const db = require('../db/pool');
const { TOPICS } = require('../languages');
const SCENARIOS = require('../languages/scenarios');
const teacher = require('./ai/teacher.service');
const engine = require('./pedagogy/engine');
const { S, walk } = require('./pedagogy/stateMachine');
const progress = require('./progress.service');
const students = require('./student.service');
const lessons = require('./lesson.service');

const { HttpError } = students;
const TURN_OPTIONS = [6, 10, 15];
const HISTORY = 12;

async function start(userId, slug, { mode, topic, scenario: scenarioId, turns }) {
  const { lang, student } = await students.requireStudentLanguage(userId, slug);
  if (!['conversation', 'roleplay'].includes(mode)) throw new HttpError(400, 'Modo inválido');
  const active = await lessons.activeLessonId(student.id, ['conversation', 'roleplay']);
  if (active) return lessons.getLesson(userId, active);

  let scenario = null;
  if (mode === 'roleplay') {
    scenario = scenarioId === 'surprise' || !scenarioId ? SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)] : SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) throw new HttpError(400, 'Cenário inválido');
  }
  if (mode === 'conversation') {
    if (!topic || topic === 'surprise') topic = engine.pickTopic({ goal: student.goal, interests: student.interests, recentTopics: await students.recentTopics(student.id) });
    if (!TOPICS.includes(topic)) throw new HttpError(400, 'Tema inválido');
  }
  const targetTurns = TURN_OPTIONS.includes(Number(turns)) ? Number(turns) : (mode === 'roleplay' ? 10 : 6);

  const memories = await progress.loadMemories(student.id, db);
  const opening = await teacher.conversationOpening({ lang, student, mode, topic, scenario, memories })
    .catch(() => { throw new HttpError(503, 'O professor está indisponível no momento. Tente de novo em instantes.'); });

  const id = await db.tx(async (c) => {
    const { state } = walk(S.LESSON_STARTED, S.INTRODUCTION, S.PRACTICE, S.WAITING_FOR_ANSWER);
    const { rows: [l] } = await c.query(
      `INSERT INTO lessons(student_language_id, topic, state, mode, scenario, target_turns, difficulty)
       VALUES ($1,$2,$3,$4,$5,$6,2) RETURNING id`,
      [student.id, mode === 'roleplay' ? scenario.namePt : topic, state, mode, scenario?.id || null, targetTurns]);
    await lessons.addMessage(c, l.id, 'teacher', 'context', opening.contextPt, { mode, goalPt: scenario?.goalPt || null });
    await lessons.addMessage(c, l.id, 'teacher', 'reply', opening.openingTarget);
    return l.id;
  });
  return lessons.getLesson(userId, id);
}

async function reply(userId, lessonId, rawText) {
  const answer = String(rawText || '').trim().slice(0, 1000);
  if (!answer) throw new HttpError(400, 'Mensagem vazia');
  const L0 = await lessons.loadLessonFor(userId, lessonId);
  if (!['conversation', 'roleplay'].includes(L0.mode)) throw new HttpError(400, 'Esta atividade não é uma conversa');
  const { rowCount } = await db.query(`UPDATE lessons SET state=$2 WHERE id=$1 AND state=$3`, [lessonId, S.EVALUATING, S.WAITING_FOR_ANSWER]);
  if (!rowCount) throw new HttpError(409, L0.state === S.LESSON_COMPLETED ? 'Conversa já encerrada' : 'Aguarde a resposta anterior');

  const { lang, student } = await students.requireStudentLanguage(userId, L0.slug);
  const scenario = SCENARIOS.find((s) => s.id === L0.scenario);
  const { rows: history } = await db.query(
    `SELECT role, content FROM (SELECT id, role, content FROM messages WHERE lesson_id=$1 AND kind IN ('reply','answer','redirect') ORDER BY id DESC LIMIT $2) t ORDER BY id`,
    [lessonId, HISTORY]);
  const skills = await students.loadSkills(student.id);
  const skillByCode = Object.fromEntries(skills.map((s) => [s.code, s.id]));
  const turn = L0.turns + 1;

  let ev;
  try {
    const memories = await progress.loadMemories(student.id, db);
    ev = await teacher.conversationTurn({ lang, student, mode: L0.mode, topic: L0.topic, scenario, history, answer, turn, targetTurns: L0.target_turns, skillCodes: skills.map((s) => s.code), memories });
  } catch {
    await db.query('UPDATE lessons SET state=$2 WHERE id=$1', [lessonId, S.WAITING_FOR_ANSWER]);
    throw new HttpError(503, 'Não consegui responder agora. Envie de novo em instantes.');
  }

  ev = engine.sanitizeEvaluation(ev, answer, { acceptWhenNoErrors: true });
  const style = student.teaching_style;
  const shown = engine.errorsToShow(ev.errors, style);
  const blocking = engine.blockingErrors(ev.errors, style);
  const accepted = engine.isAnswerAccepted(ev, style);
  const maxRetries = config.pedagogy.conversationRetries[style] ?? 1;

  let finished = false;
  await db.tx(async (c) => {
    const L = await lessons.loadLessonFor(userId, lessonId, c, true);
    await lessons.addMessage(c, lessonId, 'student', 'answer', answer);

    if (ev.offTopic) {
      await lessons.addMessage(c, lessonId, 'teacher', 'redirect', ev.redirectTarget || ev.replyTarget);
      await c.query('UPDATE lessons SET state=$2 WHERE id=$1', [lessonId, S.WAITING_FOR_ANSWER]);
      return;
    }

    await progress.addVocabulary(c, L.sl_id, ev.newVocabulary, student.level);
    await progress.bumpArea(c, L.sl_id, 'vocabulary', !ev.errors.some((e) => progress.VOCAB_ERRORS.test(e.type) && e.severity !== 'typo'), 0.08);

    // Erro importante: pede para tentar de novo (limitado pelo estilo) antes de seguir a conversa
    if (!accepted && blocking.length && L.retry_pending < maxRetries) {
      if (L.retry_pending === 0) await progress.recordErrors(c, L.sl_id, null, blocking, skillByCode, { source: 'conversation', lessonId });
      await lessons.addMessage(c, lessonId, 'teacher', 'correction', ev.feedbackTarget, {
        stage: 'RETRY', errors: shown, original: answer, explanationPt: ev.explanationPt,
        hint: L.retry_pending === 0 ? ev.hint1 : ev.hint2 || ev.hint1,
        partial: L.retry_pending > 0 ? ev.partialAnswer : null, corrected: null, askRepeat: true,
      });
      walk(S.EVALUATING, S.INCORRECT, S.RETRY, S.WAITING_FOR_ANSWER);
      await c.query('UPDATE lessons SET state=$2, retry_pending=retry_pending+1 WHERE id=$1', [lessonId, S.WAITING_FOR_ANSWER]);
      return;
    }

    if (!accepted && L.retry_pending === 0) await progress.recordErrors(c, L.sl_id, null, blocking.length ? blocking : shown, skillByCode, { source: 'conversation', lessonId });
    if (accepted) {
      const notes = shown.filter((e) => ['minor', 'relevant'].includes(e.severity));
      if (notes.length) {
        await progress.recordErrors(c, L.sl_id, null, notes, skillByCode, { source: 'conversation', lessonId });
        await lessons.addMessage(c, lessonId, 'teacher', 'note', ev.correctedSentence || '', { notes, correctedSentence: ev.correctedSentence });
      }
    } else {
      // Tentativas esgotadas: mostra a forma correta e a conversa continua
      await lessons.addMessage(c, lessonId, 'teacher', 'correction', ev.feedbackTarget, {
        stage: 'GIVE_UP', errors: shown, original: answer, explanationPt: ev.explanationPt,
        corrected: ev.correctedSentence, phonetic: ev.phonetic, askRepeat: false,
      });
    }
    await progress.bumpArea(c, L.sl_id, 'speaking', accepted, 0.1);
    await progress.bumpArea(c, L.sl_id, 'grammar', accepted && !blocking.length, 0.08);
    await progress.addXp(c, L.sl_id, accepted ? config.pedagogy.xp.conversationTurn : 1, 'conversation_turn');

    await lessons.addMessage(c, lessonId, 'teacher', 'reply', ev.replyTarget);
    finished = turn >= L.target_turns || (L.mode === 'roleplay' && ev.scenarioComplete && turn >= 3);
    await c.query('UPDATE lessons SET turns=$2, retry_pending=0, state=$3 WHERE id=$1', [lessonId, turn, S.WAITING_FOR_ANSWER]);
  });

  if (finished) return finish(userId, lessonId);
  return lessons.getLesson(userId, lessonId);
}

/** Encerra (no fim ou antes, a pedido do aluno) e gera o relatório da conversa */
async function finish(userId, lessonId) {
  const L0 = await lessons.loadLessonFor(userId, lessonId);
  if (!['conversation', 'roleplay', 'live'].includes(L0.mode)) throw new HttpError(400, 'Esta atividade não é uma conversa');
  if (L0.state === S.LESSON_COMPLETED) return lessons.getLesson(userId, lessonId);
  const spoken = L0.mode === 'live';
  if (L0.state === S.EVALUATING) throw new HttpError(409, 'Aguarde a resposta anterior');

  if (L0.turns === 0) { // nada aconteceu: descarta
    await db.query('DELETE FROM lessons WHERE id=$1', [lessonId]);
    return { id: lessonId, discarded: true, language: L0.slug };
  }
  const { lang, student } = await students.requireStudentLanguage(userId, L0.slug);
  const scenario = SCENARIOS.find((s) => s.id === L0.scenario);
  const { rows: transcript } = await db.query(
    `SELECT role, content FROM messages WHERE lesson_id=$1 AND kind IN ('reply','answer') ORDER BY id`, [lessonId]);
  const { rows: corr } = await db.query(`SELECT payload FROM messages WHERE lesson_id=$1 AND kind IN ('correction','note')`, [lessonId]);
  const seen = new Set();
  const errors = corr.flatMap((m) => m.payload.errors || m.payload.notes || [])
    .filter((e) => !progress.NON_LINGUISTIC.test(e.type) && !seen.has(e.original + e.corrected) && seen.add(e.original + e.corrected));

  let report;
  try {
    report = await teacher.finalReport({ lang, student, mode: L0.mode, topic: L0.topic, scenario, transcript: transcript.slice(spoken ? -60 : -30), errors, spoken });
  } catch {
    report = { scores: null, commentPt: 'Boa prática! Continue conversando para ganhar fluidez.', betterSentences: [], newVocabulary: [], memories: [] };
  }

  await db.tx(async (c) => {
    const L = await lessons.loadLessonFor(userId, lessonId, c, true);
    if (L.state === S.LESSON_COMPLETED) return;
    const studentTurns = transcript.filter((m) => m.role === 'student').length;
    const summary = {
      mode: L.mode, topic: L.topic, scenario: scenario?.namePt || null,
      minutes: Math.max(1, Math.round((Date.now() - new Date(L.started_at).getTime()) / 60000)),
      newVocabulary: (report.newVocabulary || []).map((v) => v.word),
      turns: L.turns, messages: studentTurns, errorsCorrected: errors.length, errors: errors.slice(0, 10),
      scores: report.scores, betterSentences: report.betterSentences, teacherComment: report.commentPt,
      accuracy: report.scores ? Math.round((report.scores.grammar + report.scores.vocabulary) / 2) : null,
    };
    walk(S.WAITING_FOR_ANSWER, S.LESSON_COMPLETED);
    await c.query('UPDATE lessons SET state=$2, completed_at=now(), summary=$3 WHERE id=$1', [lessonId, S.LESSON_COMPLETED, summary]);
    await progress.markStudied(c, L.sl_id);
    await progress.addXp(c, L.sl_id, config.pedagogy.xp.lessonCompleted, `${L.mode}_completed`);
    if (spoken) {
      // Na aula por voz as áreas são atualizadas pelo relatório final (não há avaliação turno a turno)
      await progress.addVocabulary(c, L.sl_id, report.newVocabulary || [], student.level);
      if (report.scores) {
        await progress.bumpArea(c, L.sl_id, 'speaking', report.scores.fluency >= 70, 0.25);
        await progress.bumpArea(c, L.sl_id, 'grammar', report.scores.grammar >= 70, 0.15);
        await progress.bumpArea(c, L.sl_id, 'vocabulary', report.scores.vocabulary >= 70, 0.15);
        await progress.bumpArea(c, L.sl_id, 'listening', report.scores.adequacy >= 70, 0.15);
      }
    }
    // Memória para as próximas aulas (fatos do aluno + resumo do que conversaram)
    await progress.saveMemories(c, L.sl_id, lessonId, { facts: scenario ? [] : report.memories, summary: report.sessionSummaryPt });
    await lessons.notifyAchievements(c, lessonId, L.sl_id);
    await lessons.addMessage(c, lessonId, 'teacher', 'summary', report.commentPt, summary);
  });
  return lessons.getLesson(userId, lessonId);
}

module.exports = { start, reply, finish, TURN_OPTIONS };
