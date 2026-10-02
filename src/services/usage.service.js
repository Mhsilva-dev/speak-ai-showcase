// Uso e custo da API do Gemini por usuário + limite diário de voz.
// Preços (US$ por 1M tokens, plano pago) de ai.google.dev/gemini-api/docs/pricing, conferidos em 2026-10-02.
// No plano grátis o custo real é zero; aqui fica o quanto custaria no pago (para planejar).
const { AsyncLocalStorage } = require('async_hooks');
const config = require('../config');
const db = require('../db/pool');

const context = new AsyncLocalStorage();
const currentUserId = () => context.getStore()?.userId ?? null;

// inText, inAudio, outText, outAudio
const PRICES = {
  'gemini-3.8-live': [0.75, 3.00, 4.50, 12.00],
  'gemini-3.1-flash-live-preview': [0.75, 3.00, 4.50, 12.00],
  'gemini-3.8-flash': [0.75, 1.50, 3.75, 3.75],
  'gemini-3.5-flash': [1.50, 3.00, 9.00, 9.00],
  'gemini-3.5-flash-lite': [0.30, 0.30, 2.50, 2.50],
  'gemini-3.1-flash-lite': [0.25, 0.50, 1.50, 1.50],
  'gemini-3.1-flash-tts-preview': [1.00, 1.00, 20.00, 20.00],
  'gemini-2.5-flash-preview-tts': [0.50, 0.50, 10.00, 10.00],
};
const FALLBACK_PRICE = [1.50, 3.00, 9.00, 12.00]; // modelo desconhecido: estima pelo mais caro

function cost(model, t) {
  const p = PRICES[model] || FALLBACK_PRICE;
  return (t.inText * p[0] + t.inAudio * p[1] + t.outText * p[2] + t.outAudio * p[3]) / 1e6;
}

/** Converte o usageMetadata do Gemini (generateContent ou Live) em tokens por tipo */
function tokens(u = {}) {
  const sum = (details, modality) => (details || []).filter((d) => d.modality === modality).reduce((s, d) => s + (d.tokenCount || 0), 0);
  const inTotal = u.promptTokenCount || 0;
  const inAudio = sum(u.promptTokensDetails, 'AUDIO');
  const outDetails = u.candidatesTokensDetails || u.responseTokensDetails;
  const outTotal = (u.candidatesTokenCount ?? u.responseTokenCount ?? 0) + (u.thoughtsTokenCount || 0);
  const outAudio = sum(outDetails, 'AUDIO');
  return { inText: Math.max(0, inTotal - inAudio), inAudio, outText: Math.max(0, outTotal - outAudio), outAudio };
}

const ZERO = { inText: 0, inAudio: 0, outText: 0, outAudio: 0 };
function add(a, b) { return { inText: a.inText + b.inText, inAudio: a.inAudio + b.inAudio, outText: a.outText + b.outText, outAudio: a.outAudio + b.outAudio }; }

/** Registra uma chamada. Nunca derruba a requisição se falhar. */
async function record({ userId = currentUserId(), kind, task, model, usage, ok = true, error = null, seconds = 0 }) {
  if (config.env === 'test' && !record.enabledInTest) return null;
  const t = usage ? tokens(usage) : ZERO;
  try {
    const { rows: [r] } = await db.query(
      `INSERT INTO ai_usage(user_id, kind, task, model, ok, error, in_text, in_audio, out_text, out_audio, seconds, cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [userId, kind, task, model, ok, error && String(error).slice(0, 300), t.inText, t.inAudio, t.outText, t.outAudio, seconds, cost(model, t)]);
    return r.id;
  } catch (err) { console.error('usage', err.message); return null; }
}
record.enabledInTest = false;

/** Conversa por voz: uma linha por sessão, atualizada enquanto ela acontece */
async function updateLive(id, { model, totals, seconds }) {
  if (!id) return;
  await db.query(
    'UPDATE ai_usage SET model=$2, in_text=$3, in_audio=$4, out_text=$5, out_audio=$6, seconds=$7, cost_usd=$8 WHERE id=$1',
    [id, model, totals.inText, totals.inAudio, totals.outText, totals.outAudio, Math.round(seconds), cost(model, totals)]).catch((e) => console.error('usage', e.message));
}

const TODAY_SP = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;
const DAY_SP = (col) => `(${col} AT TIME ZONE 'America/Sao_Paulo')::date`;

/** Limite de voz do usuário em minutos (null = sem limite: admin) */
async function voiceLimit(userId) {
  const { rows: [u] } = await db.query('SELECT is_admin, voice_daily_minutes FROM users WHERE id=$1', [userId]);
  if (!u) return 0;
  if (u.voice_daily_minutes != null) return u.voice_daily_minutes;
  return u.is_admin ? null : config.voiceDailyMinutes;
}

async function voiceSecondsToday(userId) {
  const { rows: [r] } = await db.query(
    `SELECT COALESCE(sum(seconds),0)::int AS s FROM ai_usage WHERE user_id=$1 AND kind='live' AND ${DAY_SP('created_at')} = ${TODAY_SP}`, [userId]);
  return r.s;
}

/** Segundos de voz que ainda restam hoje (Infinity = sem limite) */
async function voiceRemaining(userId) {
  const limit = await voiceLimit(userId);
  if (limit == null) return { limit: null, used: await voiceSecondsToday(userId), remaining: Infinity };
  const used = await voiceSecondsToday(userId);
  return { limit, used, remaining: Math.max(0, limit * 60 - used) };
}

// ---------- Painel de admin ----------
async function report(days = 30) {
  days = Math.min(Math.max(Number(days) || 30, 7), 90);
  const [perDay, perUser, perModel, totals, errors] = await Promise.all([
    db.query(`
      SELECT to_char(d, 'YYYY-MM-DD') AS day,
        COALESCE(sum(u.cost_usd) FILTER (WHERE u.kind='live'),0)::float AS live,
        COALESCE(sum(u.cost_usd) FILTER (WHERE u.kind='text'),0)::float AS text,
        COALESCE(sum(u.cost_usd) FILTER (WHERE u.kind='audio'),0)::float AS audio,
        COALESCE(sum(u.seconds) FILTER (WHERE u.kind='live'),0)::int AS voice_seconds,
        count(u.id) FILTER (WHERE u.ok)::int AS calls,
        count(u.id) FILTER (WHERE NOT u.ok)::int AS errors,
        count(DISTINCT u.user_id)::int AS users
      FROM generate_series(${TODAY_SP} - ($1::int - 1), ${TODAY_SP}, interval '1 day') d
      LEFT JOIN ai_usage u ON ${DAY_SP('u.created_at')} = d::date
      GROUP BY d ORDER BY d`, [days]),
    db.query(`
      SELECT us.id, us.name, us.email, us.is_admin, us.voice_daily_minutes,
        COALESCE(sum(a.seconds) FILTER (WHERE a.kind='live' AND ${DAY_SP('a.created_at')} = ${TODAY_SP}),0)::int AS voice_today,
        COALESCE(sum(a.seconds) FILTER (WHERE a.kind='live' AND a.created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'),0)::int AS voice_month,
        COALESCE(sum(a.cost_usd) FILTER (WHERE ${DAY_SP('a.created_at')} = ${TODAY_SP}),0)::float AS cost_today,
        COALESCE(sum(a.cost_usd) FILTER (WHERE a.created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'),0)::float AS cost_month,
        COALESCE(sum(a.cost_usd),0)::float AS cost_total,
        count(a.id) FILTER (WHERE a.created_at > now() - interval '30 days')::int AS calls_30,
        max(a.created_at) AS last_use
      FROM users us LEFT JOIN ai_usage a ON a.user_id=us.id
      GROUP BY us.id ORDER BY cost_month DESC, last_use DESC NULLS LAST`),
    db.query(`
      SELECT model, kind, count(*) FILTER (WHERE ok)::int AS calls, count(*) FILTER (WHERE NOT ok)::int AS errors,
        sum(in_text + in_audio)::bigint AS input, sum(out_text + out_audio)::bigint AS output, COALESCE(sum(cost_usd),0)::float AS cost
      FROM ai_usage WHERE created_at > now() - make_interval(days => $1::int)
      GROUP BY model, kind ORDER BY cost DESC`, [days]),
    db.query(`
      SELECT
        COALESCE(sum(cost_usd) FILTER (WHERE ${DAY_SP('created_at')} = ${TODAY_SP}),0)::float AS cost_today,
        COALESCE(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'),0)::float AS cost_month,
        COALESCE(sum(seconds) FILTER (WHERE kind='live' AND ${DAY_SP('created_at')} = ${TODAY_SP}),0)::int AS voice_today,
        COALESCE(sum(seconds) FILTER (WHERE kind='live' AND created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'),0)::int AS voice_month,
        count(*) FILTER (WHERE ok AND ${DAY_SP('created_at')} = ${TODAY_SP})::int AS calls_today,
        count(*) FILTER (WHERE NOT ok AND ${DAY_SP('created_at')} = ${TODAY_SP})::int AS errors_today,
        count(*) FILTER (WHERE NOT ok AND created_at > now() - interval '1 hour')::int AS errors_hour,
        min(created_at) AS since
      FROM ai_usage`),
    db.query(`SELECT a.created_at, a.model, a.task, a.error, us.name FROM ai_usage a LEFT JOIN users us ON us.id=a.user_id
              WHERE NOT a.ok ORDER BY a.id DESC LIMIT 8`),
  ]);
  // Projeção do mês: média dos últimos 7 dias × dias do mês
  const last7 = perDay.rows.slice(-7).reduce((s, d) => s + d.live + d.text + d.audio, 0) / 7;
  const t = totals.rows[0];
  return {
    config: { voiceDailyMinutes: config.voiceDailyMinutes, usdBrl: config.usdBrl, days },
    totals: {
      costToday: t.cost_today, costMonth: t.cost_month, projectedMonth: last7 * 30,
      voiceToday: t.voice_today, voiceMonth: t.voice_month, callsToday: t.calls_today,
      errorsToday: t.errors_today, errorsHour: t.errors_hour, since: t.since,
    },
    perDay: perDay.rows.map((d) => ({ day: d.day, live: d.live, text: d.text, audio: d.audio, voiceMin: Math.round(d.voice_seconds / 6) / 10, calls: d.calls, errors: d.errors, users: d.users })),
    perUser: perUser.rows.map((u) => ({
      id: u.id, name: u.name, email: u.email, isAdmin: u.is_admin,
      limit: u.voice_daily_minutes ?? (u.is_admin ? null : config.voiceDailyMinutes), customLimit: u.voice_daily_minutes,
      voiceToday: u.voice_today, voiceMonth: u.voice_month, costToday: u.cost_today, costMonth: u.cost_month, costTotal: u.cost_total,
      calls30: u.calls_30, lastUse: u.last_use,
    })),
    perModel: perModel.rows.map((m) => ({ ...m, input: Number(m.input), output: Number(m.output) })),
    recentErrors: errors.rows,
  };
}

module.exports = { context, currentUserId, record, updateLive, tokens, cost, voiceLimit, voiceRemaining, voiceSecondsToday, report, PRICES };
