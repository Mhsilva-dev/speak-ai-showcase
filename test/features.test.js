process.env.NODE_ENV = 'test';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const placement = require('../src/services/pedagogy/placement');
const { newAchievements, goalProgress } = require('../src/services/pedagogy/gamification');
const { compareText } = require('../src/services/pedagogy/textCompare');
const engine = require('../src/services/pedagogy/engine');
const { sniff } = require('../src/services/material.service');
const { pcmToWav } = require('../src/services/audio/tts.service');

const bank = ['A1', 'A2', 'B1', 'B2'].flatMap((level) => [0, 1, 2].map(() => ({ level })));
const run = (scores) => {
  const asked = [];
  for (const score of scores) {
    const next = placement.nextQuestion(bank, asked);
    if (!next) break;
    asked.push({ bankIndex: next.bankIndex, level: bank[next.bankIndex].level, area: 'grammar', score });
  }
  return asked;
};

describe('nivelamento adaptativo', () => {
  test('começa no A2, sobe com acerto e desce com erro', () => {
    const asked = run([90, 90, 10]);
    assert.deepEqual(asked.map((a) => a.level), ['A2', 'B1', 'B2']);
    assert.equal(placement.nextQuestion(bank, asked).bankIndex !== undefined, true);
    assert.equal(bank[placement.nextQuestion(bank, asked).bankIndex].level, 'B1');
  });
  test('para em 6 perguntas e não repete pergunta', () => {
    const asked = run([90, 90, 90, 90, 90, 90, 90]);
    assert.equal(asked.length, placement.TOTAL_QUESTIONS);
    assert.equal(new Set(asked.map((a) => a.bankIndex)).size, asked.length);
    assert.equal(placement.nextQuestion(bank, asked), null);
  });
  test('quem erra tudo fica no A1; quem acerta tudo fica no máximo disponível (B1)', () => {
    assert.equal(placement.estimate(run([0, 0, 0, 0, 0, 0])).level, 'A1');
    const top = placement.estimate(run([95, 95, 95, 95, 95, 95]));
    assert.equal(top.demonstrated, 'B2');
    assert.equal(top.level, 'B1');
  });
  test('desempenho de A2 estável gera A2 com boa confiança', () => {
    const r = placement.estimate(run([90, 20, 90, 20, 90, 20]));
    assert.equal(r.level, 'A2');
    assert.ok(r.confidence >= 40 && r.confidence <= 95);
  });
});

describe('gamificação', () => {
  test('desbloqueia só o que é novo', () => {
    const got = newAchievements({ lessons: 1, streak: 7, words: 10 }, ['FIRST_LESSON']).map((a) => a.code);
    assert.ok(got.includes('STREAK_3') && got.includes('STREAK_7'));
    assert.ok(!got.includes('FIRST_LESSON') && !got.includes('WORDS_50'));
  });
  test('meta: porcentagem limitada a 100', () => {
    assert.deepEqual(goalProgress(75, 50), { value: 75, goal: 50, pct: 100, done: true });
    assert.equal(goalProgress(10, 50).pct, 20);
  });
});

describe('comparação de texto (ditado)', () => {
  test('ignora pontuação, caixa e acentos', () => {
    assert.equal(compareText('¿Me pone un café, por favor?', 'me pone un cafe por favor').score, 100);
  });
  test('palavra faltando e erro de 1 letra', () => {
    const r = compareText('I went to the beach last weekend.', 'I went to beach last weekand');
    assert.equal(r.words.find((w) => w.word === 'the').ok, false);
    assert.equal(r.words.find((w) => w.word === 'weekend').ok, true);
    assert.ok(r.score > 60 && r.score < 100);
  });
  test('texto vazio = 0', () => {
    assert.equal(compareText('Hello there', '').score, 0);
  });
});

describe('aula do dia', () => {
  const skills = [{ id: 1, code: 'A', name: 'A', cefr_level: 'A1', score: 10, order_index: 0 }];
  test('mistura erros vencidos, palavras vencidas e habilidade', () => {
    const errors = [1, 2, 3].map((id) => ({ id, skill_id: 1, frequency: id, next_review: null, resolved: false }));
    const dueVocab = [1, 2, 3].map((id) => ({ id, difficult: id === 3, mistakes: 0, next_review: new Date() }));
    const p = engine.buildDailyPlan({ skills, errors, dueVocab, student: { level: 'A1', goal: 'viagem' } }, 6);
    assert.equal(p.reviewErrors.length, 2);
    assert.equal(p.words.length, 2);
    assert.equal(p.words[0].id, 3, 'palavra marcada como difícil vem primeiro');
    assert.equal(p.skillCount, 2);
  });
  test('sem revisões, tudo vai para a habilidade', () => {
    const p = engine.buildDailyPlan({ skills, errors: [], dueVocab: [], student: { level: 'A1', goal: 'viagem' } }, 6);
    assert.equal(p.skillCount, 6);
  });
});

describe('aula do dia: erros das conversas primeiro', () => {
  const now = new Date();
  const ago = (h) => new Date(now - h * 3600000);
  test('erro da voz de ontem entra mesmo sem estar vencido, e vem antes', () => {
    const errors = [
      { id: 1, skill_id: 1, frequency: 5, source: 'lesson', last_seen: ago(200), next_review: ago(1), resolved: false },
      { id: 2, skill_id: 1, frequency: 1, source: 'live', last_seen: ago(20), next_review: new Date(+now + 86400000), resolved: false },
    ];
    const r = engine.selectDailyReview(errors, 1, now);
    assert.deepEqual(r.map((e) => e.id), [2, 1]);
  });
  test('erro de conversa antigo (mais de 3 dias) segue a regra normal', () => {
    const errors = [{ id: 3, skill_id: 1, frequency: 1, source: 'live', last_seen: ago(24 * 5), next_review: new Date(+now + 86400000), resolved: false }];
    assert.equal(engine.selectDailyReview(errors, 1, now).length, 0);
  });
});

describe('erros fantasmas da IA', () => {
  test('descarta erro cujo trecho não está na resposta e aceita a frase na conversa', () => {
    const ev = { isCorrect: false, offTopic: false, errors: [{ original: 'watch', corrected: 'watched', severity: 'relevant' }] };
    const r = engine.sanitizeEvaluation(ev, 'Last week I watched a movie.', { acceptWhenNoErrors: true });
    assert.equal(r.errors.length, 0);
    assert.equal(r.isCorrect, true);
  });
  test('mantém erro real (ignorando pontuação e caixa)', () => {
    const ev = { isCorrect: false, offTopic: false, errors: [{ original: 'I Go,', corrected: 'I went', severity: 'critical' }] };
    assert.equal(engine.sanitizeEvaluation(ev, 'Yesterday i go to school').errors.length, 1);
  });
  test('na aula, resposta sem erros listados continua incorreta (ex.: não usou a estrutura)', () => {
    const ev = { isCorrect: false, offTopic: false, errors: [] };
    assert.equal(engine.sanitizeEvaluation(ev, 'Hello').isCorrect, false);
  });
});

describe('arquivos', () => {
  test('identifica o tipo real do upload', () => {
    assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
    assert.equal(sniff(Buffer.from('%PDF-1.7')), 'application/pdf');
    assert.equal(sniff(Buffer.from('<script>')), null);
  });
  test('PCM vira WAV válido', () => {
    const wav = pcmToWav(Buffer.alloc(100));
    assert.equal(wav.slice(0, 4).toString(), 'RIFF');
    assert.equal(wav.readUInt32LE(40), 100);
    assert.equal(wav.length, 144);
  });
});
