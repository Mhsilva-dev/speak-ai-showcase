// Lembrete por push: inscrição validada, horário, e só lembra quem não estudou hoje (uma vez por dia)
process.env.NODE_ENV = 'test';
const webpush = require('web-push');
// Chaves próprias do teste (não depende do .env)
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const app = require('../src/app');
const push = require('../src/services/push.service');

const agent = request.agent(app);
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'BKey', auth: 'auth1' } };
let userId; let slId; const sent = [];

before(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  userId = (await agent.post('/api/auth/register').send({ name: 'Rui', email: 'rui@ex.com', password: 'senha1234' })).body.user.id;
  await agent.post('/api/languages/english/enroll').send({ level: 'A2', goal: 'viagem', teachingStyle: 'balanced', interests: ['viagens'] });
  slId = (await db.query('SELECT id FROM student_languages WHERE user_id=$1', [userId])).rows[0].id;
  mock.method(webpush, 'sendNotification', async (sub, body) => { sent.push(JSON.parse(body)); });
});
after(() => db.pool.end());

test('valida o endpoint (só serviços de push conhecidos)', async () => {
  assert.equal(push.validEndpoint('https://fcm.googleapis.com/fcm/send/x'), true);
  assert.equal(push.validEndpoint('https://127.0.0.1/x'), false);
  assert.equal(push.validEndpoint('http://fcm.googleapis.com/x'), false);
  await assert.rejects(push.subscribe(userId, { endpoint: 'https://evil.com/x', keys: SUB.keys }), { status: 400 });
});

test('horário do lembrete', async () => {
  await agent.patch('/api/auth/prefs').send({ reminderHour: 3 }).expect(400);
  await agent.patch('/api/auth/prefs').send({ reminderHour: 20 }).expect(200);
  assert.equal((await agent.get('/api/auth/me')).body.user.reminderHour, 20);
});

test('lembra quem não estudou hoje, uma vez por dia; sequência em risco tem prioridade', async () => {
  await push.subscribe(userId, SUB);
  await db.query('UPDATE users SET reminder_hour=6');
  await db.query(`UPDATE student_languages SET streak_days=4, last_study_date=(now() AT TIME ZONE 'America/Sao_Paulo')::date - 1`);
  const hourSP = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false })) % 24;
  sent.length = 0;
  await push.sendReminders();
  if (hourSP < 6) { assert.equal(sent.length, 0); return; }
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /sequência de 4 dias/);
  await push.sendReminders();
  assert.equal(sent.length, 1, 'não repete no mesmo dia');
});

test('quem já estudou hoje não recebe', async () => {
  await db.query('UPDATE users SET reminder_sent_on=NULL, reminder_hour=0');
  await db.query("INSERT INTO xp_events(student_language_id, amount, reason) VALUES ($1, 10, 'teste')", [slId]);
  sent.length = 0;
  await push.sendReminders();
  assert.equal(sent.length, 0);
});

test('desligar remove o aparelho', async () => {
  await agent.delete('/api/push/subscribe').send({ endpoint: SUB.endpoint }).expect(200);
  assert.equal((await db.query('SELECT count(*)::int n FROM push_subscriptions')).rows[0].n, 0);
});
