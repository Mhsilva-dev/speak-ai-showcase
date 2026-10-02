// Login com Google: criação, ligação a conta existente, bloqueio e conta sem senha
process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const app = require('../src/app');
const auth = require('../src/services/auth.service');

before(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
});
after(() => db.pool.end());

test('cria conta nova pelo Google e reaproveita no segundo login', async () => {
  const a = await auth.loginGoogle({ sub: 'g1', email: 'Bia@Gmail.com', name: 'Bia' });
  const b = await auth.loginGoogle({ sub: 'g1', email: 'bia@gmail.com', name: 'Bia' });
  assert.equal(a.id, b.id);
  assert.equal(a.email, 'bia@gmail.com');
  await request(app).post('/api/auth/login').send({ email: 'bia@gmail.com', password: 'qualquer1' }).expect(401);
});

test('Google liga à conta existente; se o e-mail nunca foi comprovado, a senha antiga e as sessões caem', async () => {
  // Alguém cadastrou o e-mail do Caio antes dele (sem comprovar o e-mail)
  const intruso = request.agent(app);
  const r = await intruso.post('/api/auth/register').send({ name: 'Caio', email: 'caio@ex.com', password: 'senha1234' }).expect(201);
  await intruso.get('/api/auth/me').expect(200);
  const g = await auth.loginGoogle({ sub: 'g2', email: 'caio@ex.com', name: 'Caio G' });
  assert.equal(g.id, r.body.user.id);
  await intruso.get('/api/auth/me').expect(401);
  await request(app).post('/api/auth/login').send({ email: 'caio@ex.com', password: 'senha1234' }).expect(401);
});

test('conta com e-mail comprovado mantém a senha ao ligar o Google', async () => {
  await request(app).post('/api/auth/register').send({ name: 'Gil', email: 'gil@ex.com', password: 'senha1234' }).expect(201);
  await db.query("UPDATE users SET email_verified=true WHERE email='gil@ex.com'");
  await auth.loginGoogle({ sub: 'g9', email: 'gil@ex.com', name: 'Gil' });
  await request(app).post('/api/auth/login').send({ email: 'gil@ex.com', password: 'senha1234' }).expect(200);
});

test('link de descadastro do e-mail não vale como sessão', async () => {
  const weekly = require('../src/services/weekly-email.service');
  const { rows: [u] } = await db.query("SELECT id FROM users WHERE email='gil@ex.com'");
  const t = weekly.unsubscribeToken(u.id);
  await request(app).get('/api/auth/me').set('Cookie', `pid_session=${t}`).expect(401);
  const jwt = require('jsonwebtoken');
  const forjado = jwt.sign({ sub: u.id, p: 'unsub' }, require('../src/config').jwtSecret);
  await request(app).get('/api/auth/me').set('Cookie', `pid_session=${forjado}`).expect(401);
});

test('conta bloqueada não entra pelo Google', async () => {
  await db.query("UPDATE users SET blocked=true WHERE google_id='g2'");
  await assert.rejects(auth.loginGoogle({ sub: 'g2', email: 'caio@ex.com' }), { status: 403 });
});

test('rotas do Google sem configuração', async () => {
  const o = await request(app).get('/api/auth/options').expect(200);
  assert.equal(typeof o.body.google, 'boolean');
  await request(app).get('/api/auth/google/callback?code=x&state=y').expect(302).expect('location', /\/login\?erro=/);
});

test('esqueci a senha: link por e-mail, uso único e não revela e-mails', async () => {
  const mail = require('../src/services/mail.service');
  const antiga = request.agent(app);
  await antiga.post('/api/auth/register').send({ name: 'Duda', email: 'duda@ex.com', password: 'antiga123' }).expect(201);
  mail.sent.length = 0;
  await request(app).post('/api/auth/forgot').send({ email: 'ninguem@ex.com' }).expect(200);
  assert.equal(mail.sent.length, 0);
  await request(app).post('/api/auth/forgot').send({ email: 'DUDA@ex.com' }).expect(200);
  assert.equal(mail.sent.length, 1);
  // pedir de novo logo em seguida não manda outro e-mail (evita encher a caixa de alguém)
  await request(app).post('/api/auth/forgot').send({ email: 'duda@ex.com' }).expect(200);
  assert.equal(mail.sent.length, 1);
  const token = mail.sent[0].text.match(/redefinir=([\w-]+)/)[1];
  await request(app).post('/api/auth/reset').send({ token, password: '123' }).expect(400);
  const agent = request.agent(app);
  await agent.post('/api/auth/reset').send({ token, password: 'nova12345' }).expect(200);
  await agent.get('/api/auth/me').expect(200);
  await request(app).post('/api/auth/reset').send({ token, password: 'outra1234' }).expect(400);

  await request(app).post('/api/auth/login').send({ email: 'duda@ex.com', password: 'antiga123' }).expect(401);
  await request(app).post('/api/auth/login').send({ email: 'duda@ex.com', password: 'nova12345' }).expect(200);
  await antiga.get('/api/auth/me').expect(401); // sessão aberta antes da troca de senha caiu
});
