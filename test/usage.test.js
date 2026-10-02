// Uso da API: custo por tokens, limite diário de voz e relatório do admin
process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const app = require('../src/app');
const usage = require('../src/services/usage.service');

const admin = request.agent(app);
const aluno = request.agent(app);
let alunoId; let adminId;

before(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  usage.record.enabledInTest = true;
  adminId = (await admin.post('/api/auth/register').send({ name: 'Adm', email: 'adm@ex.com', password: 'senha1234' })).body.user.id;
  await db.query('UPDATE users SET is_admin=true WHERE id=$1', [adminId]);
  alunoId = (await aluno.post('/api/auth/register').send({ name: 'Lia', email: 'lia@ex.com', password: 'senha1234' })).body.user.id;
  await aluno.post('/api/languages/english/enroll').send({ level: 'A2', goal: 'viagem', teachingStyle: 'balanced', interests: ['viagens'] });
});
after(() => { usage.record.enabledInTest = false; return db.pool.end(); });

test('custo calculado por tipo de token', () => {
  const t = usage.tokens({ promptTokenCount: 1000, promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 600 }, { modality: 'TEXT', tokenCount: 400 }],
    responseTokenCount: 500, responseTokensDetails: [{ modality: 'AUDIO', tokenCount: 500 }] });
  assert.deepEqual(t, { inText: 400, inAudio: 600, outText: 0, outAudio: 500 });
  const c = usage.cost('gemini-3.8-live', t);
  assert.ok(Math.abs(c - (400 * 0.75 + 600 * 3 + 500 * 12) / 1e6) < 1e-12);
});

test('limite de voz: padrão 15 min, admin sem limite, bloqueia ao esgotar', async () => {
  let v = await usage.voiceRemaining(alunoId);
  assert.equal(v.limit, 15);
  assert.equal(v.remaining, 900);
  assert.equal((await usage.voiceRemaining(adminId)).limit, null);
  const id = await usage.record({ userId: alunoId, kind: 'live', task: 'live', model: 'gemini-3.8-live' });
  await usage.updateLive(id, { model: 'gemini-3.8-live', totals: { inText: 0, inAudio: 25000, outText: 0, outAudio: 12000 }, seconds: 900 });
  v = await usage.voiceRemaining(alunoId);
  assert.equal(v.remaining, 0);
  const r = await aluno.post('/api/languages/english/live').send({ topic: 'surprise' }).expect(429);
  assert.match(r.body.error, /15 min/);
  assert.equal((await aluno.get('/api/voice/remaining')).body.remainingSeconds, 0);
});

test('admin muda o limite de um usuário e vê o relatório', async () => {
  await aluno.get('/api/admin/usage').expect(403);
  await admin.patch(`/api/admin/users/${alunoId}`).send({ voiceDailyMinutes: -1 }).expect(400);
  await admin.patch(`/api/admin/users/${alunoId}`).send({ voiceDailyMinutes: 30 }).expect(200);
  assert.equal((await usage.voiceRemaining(alunoId)).remaining, 900);
  await aluno.post('/api/languages/english/live').send({ topic: 'surprise' }).expect(201);
  await usage.record({ userId: alunoId, kind: 'text', task: 'lesson', model: 'gemini-3.5-flash', usage: { promptTokenCount: 2000, candidatesTokenCount: 300 } });
  await usage.record({ userId: alunoId, kind: 'text', task: 'lesson', model: 'gemini-3.5-flash', ok: false, error: 'Gemini 429: quota' });
  const r = (await admin.get('/api/admin/usage?days=7').expect(200)).body;
  assert.equal(r.perDay.length, 7);
  assert.ok(r.totals.costToday > 0);
  assert.equal(r.totals.errorsToday, 1);
  assert.equal(r.totals.voiceToday, 900);
  const lia = r.perUser.find((u) => u.id === alunoId);
  assert.equal(lia.limit, 30);
  assert.equal(lia.voiceToday, 900);
  const u = (await admin.get(`/api/admin/users/${alunoId}`)).body;
  assert.equal(u.usage.customLimit, 30);
  await admin.patch(`/api/admin/users/${alunoId}`).send({ voiceDailyMinutes: null }).expect(200);
  assert.equal((await usage.voiceRemaining(alunoId)).limit, 15);
});
