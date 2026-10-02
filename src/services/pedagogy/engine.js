// Motor pedagógico: decisões puras (sem banco, sem IA) — fácil de testar.
const config = require('../../config');
const { LEVELS, GOAL_TOPICS, TOPICS } = require('../../languages');

const P = () => config.pedagogy;
const SEVERITY_WEIGHT = { critical: 3, relevant: 2, medium: 2, minor: 1, low: 1, typo: 0 };
const levelIdx = (l) => LEVELS.indexOf(l);

/**
 * Ranking das dificuldades do aluno.
 * skills: [{ id, code, name, cefr_level, order_index, score }]
 * errors: [{ skill_id, error_type, frequency, severity, next_review }]
 */
function getStudentWeaknesses(skills, errors, level, now = new Date()) {
  const available = skills.filter((s) => levelIdx(s.cefr_level) <= levelIdx(level));
  return available
    .map((s) => {
      const errs = errors.filter((e) => e.skill_id === s.id);
      const errorWeight = errs.reduce((sum, e) => sum + e.frequency * (SEVERITY_WEIGHT[e.severity] ?? 2), 0);
      const due = errs.some((e) => !e.next_review || new Date(e.next_review) <= now);
      const priority = (100 - s.score) + Math.min(60, errorWeight * 5) + (due && errs.length ? 20 : 0);
      return { ...s, errorWeight, priority };
    })
    .sort((a, b) => b.priority - a.priority
      || levelIdx(a.cefr_level) - levelIdx(b.cefr_level)
      || a.order_index - b.order_index);
}

/** Erros antigos que devem voltar na aula (vencidos no SRS, mais frequentes primeiro) */
function selectReviewContent(errors, skillId, now = new Date(), limit = 3) {
  return errors
    .filter((e) => !e.resolved && (!e.next_review || new Date(e.next_review) <= now))
    .sort((a, b) => (b.skill_id === skillId) - (a.skill_id === skillId) || b.frequency - a.frequency)
    .slice(0, limit);
}

function pickTopic({ goal, interests = [], recentTopics = [] }, rng = Math.random) {
  const pool = [...new Set([...(interests || []), ...(GOAL_TOPICS[goal] || TOPICS)])];
  const fresh = pool.filter((t) => !recentTopics.includes(t));
  const list = fresh.length ? fresh : pool;
  return list[Math.floor(rng() * list.length)];
}

/** Dificuldade inicial (1–5) a partir do domínio da habilidade */
function selectDifficulty(score) {
  if (score < 20) return 1;
  if (score < 45) return 2;
  if (score < 70) return 3;
  if (score < 85) return 4;
  return 5;
}

/** Monta o plano da próxima aula */
function getNextLesson({ skills, errors, student, recentTopics = [], topic }, rng) {
  const weaknesses = getStudentWeaknesses(skills, errors, student.level);
  const skill = weaknesses[0];
  if (!skill) return null;
  return {
    skill,
    difficulty: selectDifficulty(skill.score),
    topic: topic || pickTopic({ goal: student.goal, interests: student.interests, recentTopics }, rng),
    reviewErrors: selectReviewContent(errors, skill.id),
  };
}

/** Erros que contam para a decisão (estilo strict cobra também os pequenos) */
function blockingErrors(errors, style) {
  const blocking = style === 'strict' ? ['critical', 'relevant', 'minor'] : ['critical', 'relevant'];
  return errors.filter((e) => blocking.includes(e.severity));
}

/** O que mostrar como correção (erros de digitação nunca viram correção) */
function errorsToShow(errors, style) {
  return errors.filter((e) => e.severity !== 'typo' && (style === 'strict' || e.severity !== 'minor'));
}

/**
 * Proteção contra "erros fantasmas": a IA às vezes aponta um trecho que não está na resposta
 * (ex.: repete a correção de uma fala anterior). Só vale erro cujo trecho original aparece na resposta.
 */
function sanitizeEvaluation(evaluation, answer, { acceptWhenNoErrors = false } = {}) {
  const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}' ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const text = ` ${norm(answer)} `;
  const errors = evaluation.errors.filter((e) => {
    const o = norm(e.original);
    return !o || text.includes(` ${o} `);
  });
  const dropped = errors.length < evaluation.errors.length;
  const out = { ...evaluation, errors };
  // Conversa: se todos os erros eram fantasmas, a resposta está certa
  if (acceptWhenNoErrors && dropped && !errors.length && !evaluation.offTopic) out.isCorrect = true;
  return out;
}

function isAnswerAccepted(evaluation, style) {
  if (evaluation.offTopic) return false;
  if (style === 'strict') return evaluation.isCorrect && blockingErrors(evaluation.errors, style).length === 0;
  return evaluation.isCorrect;
}

function shouldRetry(failedAttempts, style = 'balanced') {
  return failedAttempts < (P().maxAttempts[style] ?? P().maxAttempts.balanced);
}

/**
 * Decide o próximo passo após avaliar uma resposta.
 * failedAttempts = erros anteriores neste item (antes desta resposta).
 * Retorna { action, failedAttempts, reveal: { explanation, alternative, hint1, hint2, partial, full } }
 */
function decideAfterEvaluation({ evaluation, failedAttempts, style = 'balanced' }) {
  if (evaluation.offTopic) return { action: 'OFF_TOPIC', failedAttempts, reveal: {} };
  if (isAnswerAccepted(evaluation, style)) return { action: 'CORRECT', failedAttempts, reveal: {} };

  const fails = failedAttempts + 1;
  const revealAt = P().revealAt[style] ?? P().revealAt.balanced;
  if (!shouldRetry(fails, style)) return { action: 'GIVE_UP', failedAttempts: fails, reveal: { full: true, explanation: true } };
  if (fails >= revealAt) return { action: 'DIFFICULTY_REDUCTION', failedAttempts: fails, reveal: { full: true, alternative: true } };
  if (fails === 1) return { action: 'RETRY', failedAttempts: fails, reveal: { explanation: true, hint1: true } };
  return { action: 'REINFORCEMENT', failedAttempts: fails, reveal: { alternative: true, hint2: true, partial: true } };
}

/** Ajuste de dificuldade da aula após um item concluído */
function adjustDifficulty({ difficulty, correctStreak, lastOutcome, style = 'balanced' }) {
  const need = P().streakToIncrease[style] ?? 2;
  if (lastOutcome === 'correct' && correctStreak >= need) return { difficulty: Math.min(5, difficulty + 1), changed: difficulty < 5 ? 'up' : null };
  if (lastOutcome === 'failed') return { difficulty: Math.max(1, difficulty - 1), changed: difficulty > 1 ? 'down' : null };
  return { difficulty, changed: null };
}

function shouldAdvance({ itemIndex, totalItems }) {
  return itemIndex + 1 < totalItems;
}

/** Sobe de nível quando todas as habilidades do nível atual estão dominadas */
function shouldLevelUp(skills, level) {
  const atLevel = skills.filter((s) => s.cefr_level === level);
  if (!atLevel.length || levelIdx(level) >= LEVELS.length - 1) return false;
  return atLevel.every((s) => s.score >= P().masteredThreshold);
}

/** Progresso geral = domínio médio das habilidades do nível atual */
function levelProgress(skills, level) {
  const atLevel = skills.filter((s) => s.cefr_level === level);
  if (!atLevel.length) return 0;
  return Math.round(atLevel.reduce((sum, s) => sum + Math.min(100, s.score), 0) / atLevel.length);
}

/** Domínio inicial ao entrar num nível: habilidades de níveis anteriores contam como parcialmente conhecidas */
function initialMastery(skillLevel, studentLevel) {
  return levelIdx(skillLevel) < levelIdx(studentLevel) ? 70 : 0;
}

/**
 * "Minha aula de hoje": revisão de erros vencidos + palavras vencidas + habilidade mais fraca.
 * Total fixo de itens; a habilidade sempre recebe ao menos 2.
 */
const SPOKEN = ['live', 'conversation'];

/**
 * Revisão da aula do dia: primeiro os erros das conversas (voz/texto) dos últimos 3 dias — mesmo que ainda
 * não estejam vencidos no SRS —, depois os erros vencidos. Com erros de conversa, a revisão ganha até 3 itens.
 */
function selectDailyReview(errors, skillId, now = new Date()) {
  const recent = (e) => now - new Date(e.last_seen) <= 3 * 86400000;
  const spoken = errors
    .filter((e) => !e.resolved && SPOKEN.includes(e.source) && recent(e))
    .sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen))
    .slice(0, 2);
  const due = selectReviewContent(errors.filter((e) => !spoken.includes(e)), skillId, now, 3);
  return [...spoken, ...due].slice(0, spoken.length ? 3 : 2);
}

function buildDailyPlan({ skills, errors, dueVocab, student, recentTopics = [] }, total = 6, rng) {
  const base = getNextLesson({ skills, errors, student, recentTopics }, rng);
  if (!base) return null;
  const reviewErrors = selectDailyReview(errors, base.skill.id);
  const words = dueVocab
    .slice()
    .sort((a, b) => (b.difficult - a.difficult) || (b.mistakes - a.mistakes) || (new Date(a.next_review) - new Date(b.next_review)))
    .slice(0, 2);
  return { ...base, reviewErrors, words, skillCount: Math.max(2, total - reviewErrors.length - words.length) };
}

function praise(lang, recent = [], rng = Math.random) {
  const options = lang.praise.filter((p) => !recent.includes(p));
  const list = options.length ? options : lang.praise;
  return list[Math.floor(rng() * list.length)];
}

module.exports = {
  getStudentWeaknesses, selectReviewContent, pickTopic, selectDifficulty, getNextLesson,
  blockingErrors, errorsToShow, isAnswerAccepted, sanitizeEvaluation, shouldRetry, decideAfterEvaluation,
  adjustDifficulty, shouldAdvance, shouldLevelUp, levelProgress, initialMastery, praise, buildDailyPlan, selectDailyReview,
};
