// Painel de administração: usuários, quem está online e ações de gestão (bloquear, tornar admin, senha, excluir)
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const live = require('./live.service');
const { HttpError } = require('./student.service');
const usage = require('./usage.service');
const config = require('../config');

const ONLINE_MS = 2 * 60000; // visto nos últimos 2 minutos = online

function status(lastSeen, inLive) {
  if (inLive) return 'live';
  return lastSeen && Date.now() - new Date(lastSeen) < ONLINE_MS ? 'online' : 'offline';
}

async function overview() {
  const liveIds = new Set(live.activeUserIds());
  const { rows: users } = await db.query(`
    SELECT u.id, u.name, u.email, u.is_admin, u.blocked, u.created_at, u.last_seen_at,
      COALESCE(json_agg(json_build_object('slug', l.slug, 'level', sl.level, 'xp', sl.xp, 'streak', sl.streak_days)
        ORDER BY l.id) FILTER (WHERE sl.id IS NOT NULL), '[]') AS languages,
      (SELECT count(*)::int FROM lessons x JOIN student_languages y ON y.id=x.student_language_id WHERE y.user_id=u.id) AS lessons
    FROM users u
    LEFT JOIN student_languages sl ON sl.user_id=u.id
    LEFT JOIN languages l ON l.id=sl.language_id
    GROUP BY u.id ORDER BY u.last_seen_at DESC NULLS LAST, u.created_at DESC`);
  const list = users.map((u) => ({
    id: u.id, name: u.name, email: u.email, isAdmin: u.is_admin, blocked: u.blocked,
    createdAt: u.created_at, lastSeenAt: u.last_seen_at, status: status(u.last_seen_at, liveIds.has(u.id)),
    languages: u.languages, lessons: u.lessons,
  }));
  const { rows: [k] } = await db.query(`
    SELECT (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS new7,
           (SELECT count(*)::int FROM users WHERE created_at::date = current_date) AS new_today,
           (SELECT count(*)::int FROM lessons WHERE started_at::date = current_date) AS lessons_today,
           (SELECT count(*)::int FROM users WHERE last_seen_at > now() - interval '7 days') AS active7`);
  return {
    stats: {
      users: list.length, online: list.filter((u) => u.status !== 'offline').length, live: liveIds.size,
      newToday: k.new_today, new7: k.new7, lessonsToday: k.lessons_today, active7: k.active7,
    },
    users: list,
  };
}

async function user(id) {
  const { rows: [u] } = await db.query('SELECT id, name, email, is_admin, blocked, created_at, last_seen_at, voice_daily_minutes FROM users WHERE id=$1', [id]);
  if (!u) throw new HttpError(404, 'Usuário não encontrado');
  const { rows: langs } = await db.query(`
    SELECT l.slug, l.name, sl.level, sl.goal, sl.xp, sl.streak_days AS streak, sl.last_study_date AS "lastStudy", sl.teacher_voice AS teacher
    FROM student_languages sl JOIN languages l ON l.id=sl.language_id WHERE sl.user_id=$1 ORDER BY l.id`, [id]);
  const { rows: recent } = await db.query(`
    SELECT x.id, x.mode, x.topic, x.started_at AS "startedAt", x.completed_at AS "completedAt", l.slug
    FROM lessons x JOIN student_languages sl ON sl.id=x.student_language_id JOIN languages l ON l.id=sl.language_id
    WHERE sl.user_id=$1 ORDER BY x.started_at DESC LIMIT 15`, [id]);
  const inLive = live.activeUserIds().includes(u.id);
  const { rows: [c] } = await db.query(`
    SELECT COALESCE(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'),0)::float AS month,
           COALESCE(sum(cost_usd),0)::float AS total,
           COALESCE(sum(seconds) FILTER (WHERE kind='live' AND created_at > now() - interval '30 days'),0)::int AS voice30
    FROM ai_usage WHERE user_id=$1`, [id]);
  const voice = await usage.voiceRemaining(id);
  return {
    id: u.id, name: u.name, email: u.email, isAdmin: u.is_admin, blocked: u.blocked, createdAt: u.created_at,
    lastSeenAt: u.last_seen_at, status: status(u.last_seen_at, inLive), languages: langs, recent,
    usage: {
      voiceToday: voice.used, limit: voice.limit, customLimit: u.voice_daily_minutes, defaultLimit: config.voiceDailyMinutes,
      voice30: c.voice30, costMonth: c.month, costTotal: c.total, usdBrl: config.usdBrl,
    },
  };
}

async function update(adminId, id, body = {}) {
  if (id === adminId && (body.blocked === true || body.isAdmin === false)) throw new HttpError(400, 'Você não pode bloquear nem tirar o admin da sua própria conta');
  const sets = [];
  const vals = [];
  if (typeof body.blocked === 'boolean') { vals.push(body.blocked); sets.push(`blocked=$${vals.length}`); }
  if (typeof body.isAdmin === 'boolean') { vals.push(body.isAdmin); sets.push(`is_admin=$${vals.length}`); }
  if (body.voiceDailyMinutes !== undefined) {
    const v = body.voiceDailyMinutes;
    if (v !== null && !(Number.isInteger(v) && v >= 0 && v <= 600)) throw new HttpError(400, 'Limite de voz inválido (0 a 600 minutos)');
    vals.push(v); sets.push(`voice_daily_minutes=$${vals.length}`);
  }
  if (typeof body.name === 'string' && body.name.trim()) { vals.push(body.name.trim().slice(0, 80)); sets.push(`name=$${vals.length}`); }
  if (!sets.length) throw new HttpError(400, 'Nada para alterar');
  vals.push(id);
  const { rowCount } = await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
  if (!rowCount) throw new HttpError(404, 'Usuário não encontrado');
  if (body.blocked === true) live.endFor(id); // bloqueado sai da conversa por voz na hora
  return user(id);
}

async function setPassword(id, password) {
  if (String(password || '').length < 8) throw new HttpError(400, 'A senha precisa ter pelo menos 8 caracteres');
  // Nova senha encerra as sessões abertas da pessoa
  const { rowCount } = await db.query('UPDATE users SET password_hash=$1, session_version=session_version+1 WHERE id=$2', [await bcrypt.hash(password, 10), id]);
  if (!rowCount) throw new HttpError(404, 'Usuário não encontrado');
}

async function remove(adminId, id) {
  if (id === adminId) throw new HttpError(400, 'Você não pode excluir a sua própria conta');
  live.endFor(id);
  const { rowCount } = await db.query('DELETE FROM users WHERE id=$1', [id]);
  if (!rowCount) throw new HttpError(404, 'Usuário não encontrado');
}

module.exports = { overview, user, update, setPassword, remove };
