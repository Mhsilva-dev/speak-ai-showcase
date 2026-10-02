// Painel de administração: acesso restrito, lista de usuários com status online e ações de gestão.
process.env.NODE_ENV = 'test';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const app = require('../src/app');

const boss = request.agent(app);
const user = request.agent(app);
let userId;
let bossId;

before(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  bossId = (await boss.post('/api/auth/register').send({ name: 'Chefe', email: 'chefe@ex.com', password: 'senha1234' }).expect(201)).body.user.id;
  userId = (await user.post('/api/auth/register').send({ name: 'Bia', email: 'bia@ex.com', password: 'senha1234' }).expect(201)).body.user.id;
  await db.query('UPDATE users SET is_admin=true WHERE id=$1', [bossId]);
});
after(() => db.pool.end());

describe('admin', () => {
  test('só admin acessa', async () => {
    await request(app).get('/api/admin/overview').expect(401);
    await user.get('/api/admin/overview').expect(403);
    const me = await boss.get('/api/auth/me').expect(200);
    assert.equal(me.body.user.isAdmin, true);
  });
  test('lista usuários com status online', async () => {
    await user.post('/api/auth/ping').expect(200);
    const o = await boss.get('/api/admin/overview').expect(200);
    assert.equal(o.body.stats.users, 2);
    const bia = o.body.users.find((u) => u.id === userId);
    assert.equal(bia.status, 'online');
    assert.ok(o.body.stats.online >= 1);
    const d = await boss.get(`/api/admin/users/${userId}`).expect(200);
    assert.equal(d.body.email, 'bia@ex.com');
  });
  test('bloquear tira o acesso; desbloquear devolve', async () => {
    await boss.patch(`/api/admin/users/${userId}`).send({ blocked: true }).expect(200);
    await user.get('/api/auth/me').expect(401);
    await request(app).post('/api/auth/login').send({ email: 'bia@ex.com', password: 'senha1234' }).expect(403);
    await boss.patch(`/api/admin/users/${userId}`).send({ blocked: false }).expect(200);
    await user.get('/api/auth/me').expect(200);
  });
  test('não pode bloquear nem excluir a si mesmo', async () => {
    await boss.patch(`/api/admin/users/${bossId}`).send({ blocked: true }).expect(400);
    await boss.delete(`/api/admin/users/${bossId}`).expect(400);
  });
  test('redefinir senha e excluir conta', async () => {
    await boss.post(`/api/admin/users/${userId}/password`).send({ password: 'nova12345' }).expect(200);
    await request(app).post('/api/auth/login').send({ email: 'bia@ex.com', password: 'nova12345' }).expect(200);
    await boss.delete(`/api/admin/users/${userId}`).expect(200);
    await boss.get(`/api/admin/users/${userId}`).expect(404);
  });
});
