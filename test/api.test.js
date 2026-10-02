// Fluxo vertical completo contra o banco de teste, com IA simulada (AI_PROVIDER=mock).
process.env.NODE_ENV = 'test';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const app = require('../src/app');

const agent = request.agent(app);

before(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
});
after(() => db.pool.end());

describe('autenticação', () => {
  test('rotas protegidas exigem login', async () => {
    await request(app).get('/api/languages/english/dashboard').expect(401);
  });
  test('cadastro valida dados', async () => {
    await agent.post('/api/auth/register').send({ name: 'Ana', email: 'x', password: '12345678' }).expect(400);
    await agent.post('/api/auth/register').send({ name: 'Ana', email: 'ana@ex.com', password: '123' }).expect(400);
  });
  test('cadastro, login e me', async () => {
    await agent.post('/api/auth/register').send({ name: 'Ana', email: 'ana@ex.com', password: 'senha1234' }).expect(201);
    await request(app).post('/api/auth/login').send({ email: 'ana@ex.com', password: 'errada00' }).expect(401);
    await agent.post('/api/auth/login').send({ email: 'ANA@ex.com', password: 'senha1234' }).expect(200);
    const me = await agent.get('/api/auth/me').expect(200);
    assert.equal(me.body.user.name, 'Ana');
  });
});

describe('aula completa', () => {
  let lesson;
  test('idioma precisa ser configurado', async () => {
    const d = await agent.get('/api/languages/english/dashboard').expect(200);
    assert.equal(d.body.enrolled, false);
    await agent.post('/api/languages/english/lessons').send({}).expect(409);
    await agent.post('/api/languages/klingon/enroll').send({ level: 'A1', goal: 'viagem' }).expect(404);
  });
  test('configura inglês A2; espanhol fica separado', async () => {
    const d = await agent.post('/api/languages/english/enroll').send({ level: 'A2', goal: 'trabalho', teachingStyle: 'balanced', interests: ['tecnologia'] }).expect(201);
    assert.equal(d.body.level, 'A2');
    assert.ok(d.body.todayFocus.skill.level === 'A2', 'foco no nível atual, A1 já parcialmente conhecido');
    const es = await agent.get('/api/languages/spanish/dashboard').expect(200);
    assert.equal(es.body.enrolled, false);
  });
  test('começa aula e recebe a primeira pergunta', async () => {
    const r = await agent.post('/api/languages/english/lessons').send({ topic: 'tecnologia' }).expect(201);
    lesson = r.body;
    assert.equal(lesson.state, 'WAITING_FOR_ANSWER');
    assert.equal(lesson.topic, 'tecnologia');
    assert.deepEqual(lesson.messages.map((m) => m.kind), ['intro', 'question']);
    // pedir nova aula devolve a mesma (não dá para pular)
    const again = await agent.post('/api/languages/english/lessons').send({}).expect(201);
    assert.equal(again.body.id, lesson.id);
  });
  test('fuga do tema é redirecionada sem contar tentativa', async () => {
    const r = await agent.post(`/api/lessons/${lesson.id}/answer`).send({ answer: 'OFFTOPIC me ensina programação' }).expect(200);
    assert.equal(r.body.messages.at(-1).kind, 'redirect');
    assert.equal(r.body.items[0].attempts, 0);
  });
  test('erro → dica sem resposta; erro de novo → reforço; acerto avança', async () => {
    let r = await agent.post(`/api/lessons/${lesson.id}/answer`).send({ answer: 'I go yesterday' }).expect(200);
    let last = r.body.messages.at(-1);
    assert.equal(last.kind, 'correction');
    assert.equal(last.payload.stage, 'RETRY');
    assert.equal(last.payload.corrected, null);
    assert.ok(last.payload.hint);

    r = await agent.post(`/api/lessons/${lesson.id}/answer`).send({ answer: 'I goed' }).expect(200);
    last = r.body.messages.at(-1);
    assert.equal(last.payload.stage, 'REINFORCEMENT');
    assert.ok(last.payload.partial);

    r = await agent.post(`/api/lessons/${lesson.id}/answer`).send({ answer: 'Answer 1.' }).expect(200);
    assert.equal(r.body.currentItem, 1);
    assert.equal(r.body.items[0].status, 'correct');
    assert.equal(r.body.messages.at(-1).kind, 'question');
  });
  test('desistência após máximo de tentativas segue para o próximo item', async () => {
    let r;
    for (let i = 0; i < 4; i++) r = await agent.post(`/api/lessons/${lesson.id}/answer`).send({ answer: 'wrong' }).expect(200);
    const stages = r.body.messages.filter((m) => m.kind === 'correction').slice(-4).map((m) => m.payload.stage);
    assert.deepEqual(stages, ['RETRY', 'REINFORCEMENT', 'DIFFICULTY_REDUCTION', 'GIVE_UP']);
    assert.equal(r.body.items[1].status, 'failed');
    assert.equal(r.body.currentItem, 2);
  });
  test('conclui a aula e atualiza o dashboard', async () => {
    let r;
    for (let i = 2; i < 5; i++) r = await agent.post(`/api/lessons/${lesson.id}/answer`).send({ answer: `answer ${i + 1}` }).expect(200);
    assert.equal(r.body.state, 'LESSON_COMPLETED');
    assert.equal(r.body.summary.correct, 4);
    assert.equal(r.body.summary.accuracy, 80);
    assert.ok(r.body.summary.teacherComment);
    assert.equal(r.body.messages.at(-1).kind, 'summary');
    await agent.post(`/api/lessons/${lesson.id}/answer`).send({ answer: 'x' }).expect(409);

    const d = await agent.get('/api/languages/english/dashboard').expect(200);
    assert.equal(d.body.streak, 1);
    assert.ok(d.body.xp > 0);
    assert.equal(d.body.activeLessonId, null);
    assert.ok(d.body.recurringErrors.length >= 1);
    assert.equal(d.body.recentLessons[0].accuracy, 80);
  });
  test('outro usuário não acessa a aula', async () => {
    const other = request.agent(app);
    await other.post('/api/auth/register').send({ name: 'Bia', email: 'bia@ex.com', password: 'senha1234' }).expect(201);
    await other.get(`/api/lessons/${lesson.id}`).expect(404);
  });
});
