// Relatório semanal por e-mail: toda segunda de manhã (horário de Brasília) para quem estudou na semana
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/pool');
const mail = require('./mail.service');
const reports = require('./report.service');
const { getLanguage } = require('../languages');

const AREA_PT = { speaking: 'Fala', grammar: 'Gramática', vocabulary: 'Vocabulário', listening: 'Compreensão', pronunciation: 'Pronúncia' };
const SEND_DAY = 1; // segunda
const SEND_HOUR = 8;
const e = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baseUrl = () => config.appUrl || `http://localhost:${config.port}`;

// Link de descadastro: chave própria (derivada), nunca vale como sessão
const UNSUB_SECRET = `${config.jwtSecret}:unsubscribe`;
const unsubscribeToken = (userId) => jwt.sign({ sub: userId, p: 'unsub' }, UNSUB_SECRET);
function unsubscribe(token) {
  try {
    const d = jwt.verify(String(token || ''), UNSUB_SECRET);
    return d.p === 'unsub' && Number.isInteger(d.sub) ? d.sub : null;
  } catch { return null; }
}

const fmtTime = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`);

function languageBlock(lang, r, streak) {
  const kpi = (v, l) => `<td style="padding:10px;text-align:center;background:#f4f2ff;border-radius:12px">
    <div style="font-size:22px;font-weight:bold;color:#2b2160">${v}</div><div style="font-size:12px;color:#6b6890">${l}</div></td>`;
  const areas = r.areas.map((a) => `<tr><td style="padding:4px 0">${AREA_PT[a.area]}</td><td style="text-align:right">${a.now}%
    ${a.delta > 0 ? `<span style="color:#1a9b5b">+${a.delta}</span>` : a.delta < 0 ? `<span style="color:#d0453b">${a.delta}</span>` : ''}</td></tr>`).join('');
  const diffs = r.difficulties.slice(0, 3).map((d) => `<li><s style="color:#999">${e(d.actual)}</s> → <b>${e(d.expected)}</b></li>`).join('');
  const focus = r.nextWeek.skills.map(e).join(', ');
  return `
  <h2 style="margin:28px 0 12px;font-size:18px">${lang.flag} ${e(lang.namePt)}</h2>
  <table width="100%" cellspacing="6" style="border-collapse:separate"><tr>
    ${kpi(fmtTime(r.minutes), 'estudados')}${kpi(`${r.activeDays}/7`, 'dias ativos')}${kpi(r.xp, 'XP')}${kpi(`${streak}🔥`, 'sequência')}
  </tr><tr>
    ${kpi(r.lessons, 'aulas')}${kpi(r.conversations + r.roleplays, 'conversas')}${kpi(r.words.added + r.words.reviewed, 'palavras')}${kpi(r.errorsCorrected, 'correções')}
  </tr></table>
  <table width="100%" style="margin-top:14px;font-size:14px">${areas}</table>
  ${diffs ? `<p style="margin:16px 0 4px;font-weight:bold">Para revisar</p><ul style="margin:0;padding-left:20px;font-size:14px">${diffs}</ul>` : ''}
  ${focus ? `<p style="margin:16px 0 0;font-size:14px">Na próxima semana o foco é <b>${focus}</b>. A aula do dia já prioriza isso.</p>` : ''}
  <p style="margin:18px 0 0"><a href="${baseUrl()}/${lang.slug}" style="background:#7c5cff;color:#fff;padding:11px 20px;border-radius:999px;text-decoration:none;font-weight:bold;font-size:14px">Estudar ${e(lang.namePt.toLowerCase())}</a></p>`;
}

/** Monta o e-mail de um usuário; null se ele não estudou nada na semana */
async function build(user) {
  const { rows } = await db.query(
    `SELECT l.slug, sl.streak_days FROM student_languages sl JOIN languages l ON l.id=sl.language_id WHERE sl.user_id=$1 ORDER BY sl.id`, [user.id]);
  const blocks = [];
  const totals = { minutes: 0, xp: 0 };
  for (const row of rows) {
    const r = await reports.weekly(user.id, row.slug);
    if (!r.xp && !r.minutes) continue;
    totals.minutes += r.minutes; totals.xp += r.xp;
    blocks.push(languageBlock(getLanguage(row.slug), r, row.streak_days));
  }
  if (!blocks.length) return null;
  const first = e(String(user.name).split(' ')[0]);
  const headline = totals.minutes ? `Você estudou ${fmtTime(totals.minutes)} nesta semana.` : `Você ganhou ${totals.xp} XP nesta semana.`;
  const unsub = `${baseUrl()}/api/email/unsubscribe?t=${unsubscribeToken(user.id)}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#222;padding:8px">
    <p style="color:#7c5cff;font-weight:bold;margin:0">SPEAK AI · SUA SEMANA</p>
    <h1 style="font-size:24px;margin:6px 0 4px">Oi, ${first}! ${headline}</h1>
    <p style="color:#6b6890;margin:0">Resumo dos últimos 7 dias. Bora manter o ritmo?</p>
    ${blocks.join('')}
    <p style="color:#999;font-size:12px;margin-top:36px">Você recebe este resumo toda segunda.
      <a href="${unsub}" style="color:#999">Não quero mais receber</a>.</p></div>`;
  const text = `Oi, ${String(user.name).split(' ')[0]}! Você estudou ${fmtTime(totals.minutes)} e ganhou ${totals.xp} XP nesta semana no Speak AI.\nVeja o relatório completo: ${baseUrl()}\n\nPara não receber mais: ${unsub}`;
  return { to: user.email, subject: totals.minutes ? `Sua semana no Speak AI: ${fmtTime(totals.minutes)} de estudo` : `Sua semana no Speak AI: ${totals.xp} XP`, html, text };
}

/** Envia para quem ainda não recebeu nesta semana (de segunda a domingo). `force` = teste manual: ignora e não marca o envio. */
async function sendAll({ onlyUserId = null, force = false } = {}) {
  const { rows } = await db.query(
    `SELECT id, name, email FROM users WHERE NOT blocked AND ($1::int IS NOT NULL OR weekly_email)
       AND ($1::int IS NULL OR id=$1) AND ($2 OR weekly_email_sent_at IS NULL
         OR weekly_email_sent_at < date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`,
    [onlyUserId, force]);
  let sent = 0;
  for (const user of rows) {
    try {
      const msg = await build(user);
      if (msg) { await mail.send(msg); sent++; }
      if (!force) await db.query('UPDATE users SET weekly_email_sent_at=now() WHERE id=$1', [user.id]);
    } catch (err) { console.error('relatório semanal', user.id, err.message); }
  }
  return { checked: rows.length, sent };
}

/** Verifica a cada 30 min; na segunda a partir das 8h dispara (cada usuário recebe uma vez por semana) */
function schedule() {
  if (!mail.enabled() || config.env === 'test') return;
  const tick = () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    if (now.getDay() === SEND_DAY && now.getHours() >= SEND_HOUR) {
      sendAll().then((r) => r.sent && console.log(`relatório semanal: ${r.sent} e-mail(s)`)).catch((err) => console.error(err));
    }
  };
  setInterval(tick, 30 * 60000).unref();
  tick();
}

module.exports = { build, sendAll, schedule, unsubscribe, unsubscribeToken };
