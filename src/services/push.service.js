// Lembrete diário por push (Web Push/VAPID): quem ainda não estudou hoje recebe um aviso no horário escolhido
const webpush = require('web-push');
const config = require('../config');
const db = require('../db/pool');
const { HttpError } = require('./student.service');
const { getLanguage } = require('../languages');
const { getTeacher } = require('../languages/teachers');

const TODAY = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;
const enabled = () => Boolean(config.push.publicKey && config.push.privateKey);
if (enabled()) webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);

// Só serviços de push dos navegadores: sem isso o servidor poderia ser usado para chamar endereços internos
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/, /^web\.push\.apple\.com$/];
function validEndpoint(endpoint) {
  try {
    const u = new URL(String(endpoint));
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((r) => r.test(u.hostname));
  } catch { return false; }
}

async function subscribe(userId, { endpoint, keys } = {}) {
  if (!enabled()) throw new HttpError(503, 'Notificações ainda não estão disponíveis');
  if (!validEndpoint(endpoint) || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string'
    || keys.p256dh.length > 200 || keys.auth.length > 100) throw new HttpError(400, 'Inscrição inválida');
  await db.query(
    `INSERT INTO push_subscriptions(endpoint, user_id, p256dh, auth) VALUES ($1,$2,$3,$4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id=$2, p256dh=$3, auth=$4`, [endpoint, userId, keys.p256dh, keys.auth]);
}

async function unsubscribe(userId, endpoint) {
  await db.query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2', [String(endpoint || ''), userId]);
}

async function setHour(userId, hour) {
  if (hour !== null && !(Number.isInteger(hour) && hour >= 6 && hour <= 23)) throw new HttpError(400, 'Horário inválido');
  await db.query('UPDATE users SET reminder_hour=$1 WHERE id=$2', [hour, userId]);
}

/** Envia para todos os aparelhos do usuário; apaga inscrições que o navegador já cancelou */
async function sendToUser(userId, payload) {
  const { rows } = await db.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=$1', [userId]);
  let sent = 0;
  for (const s of rows) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600 });
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) await db.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [s.endpoint]);
      else console.error('push', userId, err.statusCode || err.message);
    }
  }
  return sent;
}

/** Texto do lembrete: sequência em risco tem prioridade; senão, convite do professor do idioma mais usado */
async function reminderFor(userId) {
  const { rows } = await db.query(
    `SELECT l.slug, l.code, sl.teacher_voice, sl.streak_days, sl.last_study_date, sl.last_study_date = ${TODAY} - 1 AS yesterday
       FROM student_languages sl JOIN languages l ON l.id=sl.language_id
      WHERE sl.user_id=$1 ORDER BY sl.last_study_date DESC NULLS LAST, sl.xp DESC`, [userId]);
  if (!rows[0]) return null;
  const atRisk = rows.find((r) => r.yesterday && r.streak_days >= 2);
  if (atRisk) {
    return { title: `🔥 Sua sequência de ${atRisk.streak_days} dias está em risco`,
      body: 'Uma aula rápida hoje mantém o fogo aceso. Bora?', url: `/${atRisk.slug}`, tag: 'reminder' };
  }
  const r = rows[0];
  const lang = getLanguage(r.slug);
  const teacher = getTeacher(r.teacher_voice, r.code).voice;
  return { title: `Hora do seu ${lang.namePt.toLowerCase()}`,
    body: `${teacher} está te esperando. Que tal 5 minutinhos de prática agora?`, url: `/${r.slug}`, tag: 'reminder' };
}

/** Quem tem aparelho inscrito, já passou do horário, ainda não foi lembrado hoje e não estudou hoje */
async function sendReminders() {
  const { rows } = await db.query(
    `SELECT u.id FROM users u
      WHERE NOT u.blocked AND u.reminder_hour IS NOT NULL
        AND u.reminder_hour <= EXTRACT(HOUR FROM now() AT TIME ZONE 'America/Sao_Paulo')
        AND (u.reminder_sent_on IS NULL OR u.reminder_sent_on < ${TODAY})
        AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id=u.id)`);
  let sent = 0;
  for (const { id } of rows) {
    await db.query(`UPDATE users SET reminder_sent_on=${TODAY} WHERE id=$1`, [id]);
    const { rows: [s] } = await db.query(
      `SELECT EXISTS (SELECT 1 FROM xp_events x JOIN student_languages sl ON sl.id=x.student_language_id
         WHERE sl.user_id=$1 AND (x.created_at AT TIME ZONE 'America/Sao_Paulo')::date = ${TODAY}) AS studied`, [id]);
    if (s.studied) continue;
    const payload = await reminderFor(id);
    if (payload && await sendToUser(id, payload)) sent++;
  }
  return sent;
}

function schedule() {
  if (!enabled() || config.env === 'test') return;
  const tick = () => sendReminders().then((n) => n && console.log(`lembretes push: ${n}`)).catch((err) => console.error(err));
  setInterval(tick, 10 * 60000).unref();
  tick();
}

module.exports = { enabled, subscribe, unsubscribe, setHour, sendToUser, reminderFor, sendReminders, schedule, validEndpoint };
