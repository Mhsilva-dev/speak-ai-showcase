process.env.NODE_ENV = 'test';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { extractJSON, AIError } = require('../src/services/ai/gemini.service');
const { evaluationSchema, lessonPlanSchema } = require('../src/services/ai/schemas');

describe('validação das respostas do Gemini', () => {
  test('aceita JSON em cerca de markdown e com texto em volta', () => {
    assert.deepEqual(extractJSON('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(extractJSON('Claro! {"a": [1,2,],} espero ajudar'), { a: [1, 2] });
  });
  test('lança AIError recuperável para lixo', () => {
    assert.throws(() => extractJSON('sem json aqui'), (e) => e instanceof AIError && e.retryable);
  });
  test('avaliação: normaliza tipo do erro e severidade desconhecida', () => {
    const r = evaluationSchema.parse({
      isCorrect: false, feedbackTarget: 'Almost!',
      errors: [{ type: 'past simple', original: 'go', corrected: 'went', severity: 'huge' }],
    });
    assert.equal(r.errors[0].type, 'PAST_SIMPLE');
    assert.equal(r.errors[0].severity, 'relevant');
    assert.equal(r.offTopic, false);
    assert.equal(r.hint1, null);
  });
  test('avaliação sem isCorrect é rejeitada', () => {
    assert.equal(evaluationSchema.safeParse({ feedbackTarget: 'x' }).success, false);
  });
  test('plano de aula exige itens', () => {
    assert.equal(lessonPlanSchema.safeParse({ introTarget: 'a', introPt: 'b', items: [] }).success, false);
  });
});
