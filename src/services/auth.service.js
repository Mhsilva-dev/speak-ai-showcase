// Contas e sessões: cadastro, login (senha ou Google), "esqueci a senha" e leitura do usuário logado.
// A sessão é um JWT no cookie httpOnly; ele carrega a versão da sessão (sv), que muda quando a senha muda.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/pool');
const { HttpError } = require('./student.service');
const mail = require('./mail.service');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLOCKED = 'Sua conta está bloqueada. Fale com o suporte.';
const RESET_MINUTES = 60;          // validade do link de redefinição
const RESET_COOLDOWN_SECONDS = 120; // no máximo 1 e-mail de redefinição a cada 2 min por pessoa
// Hash de mentira: compara mesmo quando o e-mail não existe, para o tempo de resposta não revelar quem tem conta
const DUMMY_HASH = bcrypt.hashSync('nao-e-uma-senha', 10);

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();
const toUser = (u) => ({ id: u.id, name: u.name, email: u.email, isAdmin: u.is_admin });

// ---------- Sessão ----------

/** Cria o token de sessão (30 dias) */
function sign(userId, sessionVersion) {
  return jwt.sign({ sub: userId, sv: sessionVersion }, config.jwtSecret, { expiresIn: '30d' });
}

/** Lê o token de sessão → { id, sv } ou null. Tokens de outro propósito (ex.: descadastro de e-mail) são recusados. */
function verify(token) {
  try {
    const d = jwt.verify(String(token || ''), config.jwtSecret);
    if (d.p || !Number.isInteger(d.sub)) return null;
    return { id: d.sub, sv: d.sv ?? 0 };
  } catch { return null; }
}

async function sessionVersion(userId) {
  const { rows: [u] } = await db.query('SELECT session_version FROM users WHERE id=$1', [userId]);
  return u?.session_version ?? 0;
}

/** Usuário da sessão (null se não existe, está bloqueado ou a sessão foi encerrada por troca de senha) */
async function getUser(id, sv = null) {
  const { rows: [u] } = await db.query(
    'SELECT id, name, email, is_admin, blocked, last_seen_at, weekly_email, reminder_hour, session_version FROM users WHERE id=$1', [id]);
  if (!u || u.blocked) return null;
  if (sv !== null && u.session_version !== sv) return null;
  // "Visto por último" (painel de admin): grava no máximo 1x por minuto
  if (!u.last_seen_at || Date.now() - new Date(u.last_seen_at) > 60000) {
    db.query('UPDATE users SET last_seen_at=now() WHERE id=$1', [id]).catch(() => {});
  }
  return { ...toUser(u), weeklyEmail: u.weekly_email, reminderHour: u.reminder_hour };
}

// ---------- Cadastro e login ----------

async function register({ name, email, password }) {
  name = String(name || '').trim().slice(0, 80);
  email = normEmail(email);
  if (!name) throw new HttpError(400, 'Informe seu nome');
  if (!EMAIL.test(email)) throw new HttpError(400, 'E-mail inválido');
  if (String(password || '').length < 8) throw new HttpError(400, 'A senha precisa ter pelo menos 8 caracteres');
  const hash = await bcrypt.hash(password, 10);
  const { rows: [u] } = await db.query(
    'INSERT INTO users(name, email, password_hash) VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING RETURNING *',
    [name, email, hash]);
  if (!u) throw new HttpError(409, 'Este e-mail já está cadastrado');
  return toUser(u);
}

async function login({ email, password }) {
  const { rows: [user] } = await db.query('SELECT * FROM users WHERE email=$1', [normEmail(email)]);
  if (user && !user.password_hash) throw new HttpError(401, 'Esta conta entra com o Google. Use o botão "Continuar com Google".');
  const ok = await bcrypt.compare(String(password || ''), user?.password_hash || DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'E-mail ou senha incorretos');
  if (user.blocked) throw new HttpError(403, BLOCKED);
  return toUser(user);
}

/**
 * Login com Google (e-mail já verificado pelo Google): acha pelo google_id, senão liga à conta com o mesmo e-mail,
 * senão cria a conta. Se a conta existente nunca comprovou o e-mail, a senha dela é apagada e as sessões encerradas:
 * assim quem cadastrou o e-mail de outra pessoa antes perde o acesso quando o dono de verdade entra.
 */
async function loginGoogle({ sub, email, name }) {
  email = normEmail(email);
  let { rows: [user] } = await db.query('SELECT * FROM users WHERE google_id=$1', [sub]);
  if (!user) {
    ({ rows: [user] } = await db.query(
      `UPDATE users SET google_id=$1,
         password_hash = CASE WHEN email_verified THEN password_hash END,
         session_version = session_version + CASE WHEN email_verified THEN 0 ELSE 1 END,
         email_verified = true
       WHERE email=$2 AND google_id IS NULL RETURNING *`, [sub, email]));
  }
  if (!user) {
    ({ rows: [user] } = await db.query(
      'INSERT INTO users(name, email, google_id, email_verified) VALUES ($1,$2,$3,true) RETURNING *',
      [String(name || email.split('@')[0]).trim().slice(0, 80), email, sub]));
  }
  if (user.blocked) throw new HttpError(403, BLOCKED);
  return toUser(user);
}

// ---------- Esqueci a senha ----------

/**
 * Manda o link de redefinição. A resposta é sempre a mesma (não revela se o e-mail tem conta)
 * e o envio é em segundo plano (o tempo de resposta também não revela).
 */
async function forgotPassword(email, baseUrl) {
  email = normEmail(email);
  if (!EMAIL.test(email)) throw new HttpError(400, 'E-mail inválido');
  if (!mail.enabled()) throw new HttpError(503, 'Recuperação de senha ainda não está disponível. Fale com o suporte.');
  const { rows: [user] } = await db.query('SELECT id, name, blocked FROM users WHERE email=$1', [email]);
  if (!user || user.blocked) return;
  const { rows: [recent] } = await db.query(
    `SELECT 1 FROM password_resets WHERE user_id=$1 AND created_at > now() - make_interval(secs => $2)`, [user.id, RESET_COOLDOWN_SECONDS]);
  if (recent) return; // já mandou há pouco: evita encher a caixa de alguém

  const token = crypto.randomBytes(32).toString('base64url');
  await db.query('DELETE FROM password_resets WHERE user_id=$1 OR expires_at < now()', [user.id]);
  await db.query('INSERT INTO password_resets(token_hash, user_id, expires_at) VALUES ($1,$2, now() + make_interval(mins => $3))',
    [hashToken(token), user.id, RESET_MINUTES]);
  const link = `${baseUrl}/login?redefinir=${token}`;
  const first = String(user.name).split(' ')[0];
  mail.send({
    to: email,
    subject: 'Redefinir sua senha do Speak AI',
    text: `Oi, ${first}!\n\nPara criar uma senha nova, abra o link abaixo (vale por 1 hora):\n${link}\n\nSe não foi você que pediu, ignore este e-mail.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#222">
      <h2 style="margin:0 0 12px">Redefinir sua senha</h2>
      <p>Oi, ${first.replace(/[<>&"]/g, '')}! Clique no botão para criar uma senha nova. O link vale por 1 hora.</p>
      <p style="margin:24px 0"><a href="${link}" style="background:#7c5cff;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Criar senha nova</a></p>
      <p style="color:#777;font-size:13px">Se não foi você que pediu, ignore este e-mail. Sua senha continua a mesma.</p></div>`,
  }).catch((err) => console.error('e-mail de redefinição', err.message));
}

/** Troca a senha pelo link do e-mail: comprova o e-mail e encerra as sessões abertas em outros aparelhos */
async function resetPassword({ token, password }) {
  if (String(password || '').length < 8) throw new HttpError(400, 'A senha precisa ter pelo menos 8 caracteres');
  const { rows: [r] } = await db.query(
    'UPDATE password_resets SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now() RETURNING user_id',
    [hashToken(String(token || ''))]);
  if (!r) throw new HttpError(400, 'Este link expirou ou já foi usado. Peça um novo.');
  await db.query(
    'UPDATE users SET password_hash=$1, email_verified=true, session_version=session_version+1 WHERE id=$2',
    [await bcrypt.hash(password, 10), r.user_id]);
  await db.query('DELETE FROM password_resets WHERE user_id=$1', [r.user_id]);
  const user = await getUser(r.user_id);
  if (!user) throw new HttpError(403, BLOCKED);
  return user;
}

module.exports = { sign, verify, sessionVersion, getUser, register, login, loginGoogle, forgotPassword, resetPassword };
