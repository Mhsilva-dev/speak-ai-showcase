// Relatório semanal por e-mail: só para quem estudou, uma vez por semana, com descadastro
process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const app = require('../src/app');
const mail = require('../src/services/mail.service');
const weekly = require('../src/services/weekly-email.service');

const agent = request.agent(app);
let userId;

before(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  userId = (await agent.post('/api/auth/register').send({ name: 'Eva Lima', email: 'eva@ex.com', password: 'senha1234' })).body.user.id;
  await agent.post('/api/languages/english/enroll').send({ level: 'A2', goal: 'viagem', teachingStyle: 'balanced', interests: ['viagens'] });
});
after(() => db.pool.end());

test('sem estudo na semana, não manda e-mail', async () => {
  mail.sent.length = 0;
  await db.query('UPDATE users SET weekly_email_sent_at=NULL');
  await weekly.sendAll();
  assert.equal(mail.sent.length, 0);
});

test('com estudo, manda uma vez por semana', async () => {
  const { rows: [sl] } = await db.query('SELECT id FROM student_languages WHERE user_id=$1', [userId]);
  assert.ok(sl, 'idioma configurado');
  await db.query("INSERT INTO xp_events(student_language_id, amount, reason) VALUES ($1, 30, 'teste')", [sl.id]);
  await db.query('UPDATE users SET weekly_email_sent_at=NULL');
  mail.sent.length = 0;
  await weekly.sendAll();
  assert.equal(mail.sent.length, 1);
  assert.match(mail.sent[0].html, /Oi, Eva!/);
  assert.match(mail.sent[0].html, /Inglês/);
  await weekly.sendAll();
  assert.equal(mail.sent.length, 1, 'não repete na mesma semana');
});

test('descadastro pelo link e preferência na conta', async () => {
  const t = weekly.unsubscribeToken(userId);
  await request(app).get(`/api/email/unsubscribe?t=${t}`).expect(200);
  assert.equal((await agent.get('/api/auth/me')).body.user.weeklyEmail, true, 'GET não descadastra');
  await request(app).post(`/api/email/unsubscribe?t=${t}`).expect(200);
  assert.equal((await agent.get('/api/auth/me')).body.user.weeklyEmail, false);
  await request(app).post('/api/email/unsubscribe?t=falso').expect(400);
  await db.query('UPDATE users SET weekly_email_sent_at=NULL');
  mail.sent.length = 0;
  await weekly.sendAll();
  assert.equal(mail.sent.length, 0);
  await agent.patch('/api/auth/prefs').send({ weeklyEmail: true }).expect(200);
  assert.equal((await agent.get('/api/auth/me')).body.user.weeklyEmail, true);
});
