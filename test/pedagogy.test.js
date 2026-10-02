process.env.NODE_ENV = 'test';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/services/pedagogy/engine');
const { S, walk, canTransition, InvalidTransitionError } = require('../src/services/pedagogy/stateMachine');
const { calculateMastery, masteryBand, updateArea } = require('../src/services/pedagogy/mastery');
const srs = require('../src/services/pedagogy/srs');

const skill = (id, code, cefr, score, order = id) => ({ id, code, name: code, cefr_level: cefr, score, order_index: order });

describe('máquina de estados', () => {
  test('fluxo feliz de uma aula', () => {
    const { state } = walk(S.LESSON_STARTED, S.INTRODUCTION, S.PRACTICE, S.WAITING_FOR_ANSWER, S.EVALUATING, S.CORRECT, S.NEXT_ACTIVITY, S.PRACTICE);
    assert.equal(state, S.PRACTICE);
  });
  test('erro → retry → nova resposta', () => {
    assert.equal(walk(S.EVALUATING, S.INCORRECT, S.RETRY, S.WAITING_FOR_ANSWER).state, S.WAITING_FOR_ANSWER);
  });
  test('não permite pular da pergunta para a conclusão por acerto', () => {
    assert.equal(canTransition(S.WAITING_FOR_ANSWER, S.CORRECT), false);
    assert.throws(() => walk(S.WAITING_FOR_ANSWER, S.CORRECT), InvalidTransitionError);
  });
  test('aula concluída é estado final', () => {
    assert.throws(() => walk(S.LESSON_COMPLETED, S.PRACTICE), InvalidTransitionError);
  });
});

describe('domínio (mastery)', () => {
  test('acerto de primeira sobe mais que acerto após erro', () => {
    const first = calculateMastery(40, { correct: true, failedAttempts: 0, difficulty: 2 });
    const later = calculateMastery(40, { correct: true, failedAttempts: 2, difficulty: 2 });
    assert.ok(first > later && later > 40);
  });
  test('falha reduz e respeita limites 0..100', () => {
    assert.equal(calculateMastery(3, { correct: false }), 0);
    assert.equal(calculateMastery(98, { correct: true, difficulty: 5 }), 100);
  });
  test('faixas configuráveis', () => {
    assert.equal(masteryBand(10), 'iniciante');
    assert.equal(masteryBand(45), 'em desenvolvimento');
    assert.equal(masteryBand(70), 'bom');
    assert.equal(masteryBand(95), 'dominado');
    assert.equal(masteryBand(50, [{ max: 50, label: 'x' }, { max: 100, label: 'y' }]), 'x');
  });
  test('área converge com evidências', () => {
    let s = 0;
    for (let i = 0; i < 30; i++) s = updateArea(s, true);
    assert.ok(s > 95);
  });
});

describe('repetição espaçada', () => {
  test('sequência 1 → 3 → 7 → 14 → 30 → graduado', () => {
    let d = 0; const seen = [];
    for (let i = 0; i < 5; i++) { d = srs.nextReview(d, true).intervalDays; seen.push(d); }
    assert.deepEqual(seen, [1, 3, 7, 14, 30]);
    assert.equal(srs.nextReview(30, true).graduated, true);
  });
  test('erro volta para 1 dia', () => {
    assert.equal(srs.nextReview(14, false).intervalDays, 1);
  });
});

describe('motor pedagógico', () => {
  const skills = [skill(1, 'TO_BE', 'A1', 90), skill(2, 'PRESENT', 'A1', 50), skill(3, 'PAST', 'A2', 20), skill(4, 'PERFECT', 'B1', 0)];

  test('não seleciona habilidade acima do nível', () => {
    const w = engine.getStudentWeaknesses(skills, [], 'A2');
    assert.ok(!w.some((s) => s.code === 'PERFECT'));
    assert.equal(w[0].code, 'PAST');
  });
  test('erros recorrentes priorizam a habilidade', () => {
    const errors = [{ skill_id: 2, frequency: 6, severity: 'critical', next_review: null }];
    assert.equal(engine.getStudentWeaknesses(skills, errors, 'A2')[0].code, 'PRESENT');
  });
  test('revisão traz só erros vencidos', () => {
    const past = new Date(Date.now() - 1000), future = new Date(Date.now() + 86400000);
    const sel = engine.selectReviewContent([
      { id: 1, skill_id: 3, frequency: 1, next_review: past },
      { id: 2, skill_id: 3, frequency: 9, next_review: future },
    ], 3);
    assert.deepEqual(sel.map((e) => e.id), [1]);
  });
  test('próxima aula usa o tema escolhido ou evita os recentes', () => {
    const student = { level: 'A2', goal: 'viagem', interests: [] };
    assert.equal(engine.getNextLesson({ skills, errors: [], student, topic: 'futebol' }).topic, 'futebol');
    const t = engine.getNextLesson({ skills, errors: [], student, recentTopics: ['viagens', 'comida'] }).topic;
    assert.equal(t, 'cotidiano');
  });

  const wrong = { offTopic: false, isCorrect: false, errors: [{ severity: 'critical' }] };
  test('progressão de erros: retry → reforço → guiado → segue', () => {
    const steps = [0, 1, 2, 3].map((f) => engine.decideAfterEvaluation({ evaluation: wrong, failedAttempts: f, style: 'balanced' }).action);
    assert.deepEqual(steps, ['RETRY', 'REINFORCEMENT', 'DIFFICULTY_REDUCTION', 'GIVE_UP']);
  });
  test('não revela a resposta na primeira tentativa', () => {
    const d = engine.decideAfterEvaluation({ evaluation: wrong, failedAttempts: 0 });
    assert.equal(d.reveal.full, undefined);
    assert.equal(d.reveal.hint1, true);
  });
  test('modo strict cobra mais repetição', () => {
    assert.ok(engine.shouldRetry(4, 'strict'));
    assert.ok(!engine.shouldRetry(4, 'balanced'));
    const minorOnly = { isCorrect: true, errors: [{ severity: 'minor' }] };
    assert.equal(engine.isAnswerAccepted(minorOnly, 'strict'), false);
    assert.equal(engine.isAnswerAccepted(minorOnly, 'balanced'), true);
  });
  test('fuga do tema não conta tentativa', () => {
    const d = engine.decideAfterEvaluation({ evaluation: { offTopic: true, errors: [] }, failedAttempts: 1 });
    assert.equal(d.action, 'OFF_TOPIC');
    assert.equal(d.failedAttempts, 1);
  });
  test('erro de digitação não vira correção', () => {
    const shown = engine.errorsToShow([{ severity: 'typo' }, { severity: 'minor' }, { severity: 'critical' }], 'balanced');
    assert.deepEqual(shown.map((e) => e.severity), ['critical']);
  });
  test('dificuldade adapta', () => {
    assert.equal(engine.adjustDifficulty({ difficulty: 2, correctStreak: 2, lastOutcome: 'correct' }).difficulty, 3);
    assert.equal(engine.adjustDifficulty({ difficulty: 2, correctStreak: 1, lastOutcome: 'correct' }).difficulty, 2);
    assert.equal(engine.adjustDifficulty({ difficulty: 1, correctStreak: 0, lastOutcome: 'failed' }).difficulty, 1);
  });
  test('sobe de nível só com tudo dominado', () => {
    assert.equal(engine.shouldLevelUp([skill(1, 'a', 'A1', 90), skill(2, 'b', 'A1', 50)], 'A1'), false);
    assert.equal(engine.shouldLevelUp([skill(1, 'a', 'A1', 90), skill(2, 'b', 'A1', 85)], 'A1'), true);
  });
  test('elogios variam', () => {
    const lang = { praise: ['A', 'B', 'C'] };
    assert.equal(engine.praise(lang, ['A', 'B'], () => 0), 'C');
  });
});
