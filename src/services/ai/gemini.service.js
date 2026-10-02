// Único ponto de contato com o Gemini: timeout, retry, fallback de modelo, extração/validação de JSON e logs.
const config = require('../../config');
const usage = require('../usage.service');

class AIError extends Error {
  constructor(message, { retryable = false, cause } = {}) {
    super(message);
    this.name = 'AIError';
    this.retryable = retryable;
    this.cause = cause;
  }
}

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

function log(level, msg, extra = {}) {
  if (config.env === 'test') return;
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({ at: new Date().toISOString(), svc: 'ai', level, msg, ...extra }));
}

// Tenta recuperar JSON de respostas "quase certas" (cercas de markdown, texto em volta, vírgula sobrando)
function extractJSON(text) {
  if (typeof text !== 'string') throw new AIError('Resposta vazia');
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* tenta reparar */ }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw new AIError('JSON não encontrado na resposta', { retryable: true });
  t = t.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(t); } catch (e) { throw new AIError('JSON inválido', { retryable: true, cause: e }); }
}

async function post(model, payload, timeoutMs = config.ai.timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}/${model}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.ai.geminiApiKey },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new AIError(`Gemini ${res.status}: ${body?.error?.message || 'erro'}`, { retryable: retryable || res.status === 404 });
    }
    return body;
  } catch (err) {
    if (err.name === 'AbortError') throw new AIError('Timeout do Gemini', { retryable: true });
    if (err instanceof AIError) throw err;
    throw new AIError(`Falha de rede: ${err.message}`, { retryable: true, cause: err });
  } finally {
    clearTimeout(timer);
  }
}

// Modelo sem cota (429 "retry in Xs") fica de castigo até liberar: as próximas chamadas pulam direto para o seguinte
const cooldown = new Map();
function markCooldown(model, message) {
  const m = /retry in ([\d.]+)s/i.exec(message);
  cooldown.set(model, Date.now() + (m ? Number(m[1]) * 1000 : 60000));
}
function usable(models) {
  const now = Date.now();
  const free = models.filter((m) => !(cooldown.get(m) > now));
  // Todos de castigo: tenta o que libera primeiro
  return free.length ? free : [...models].sort((a, b) => cooldown.get(a) - cooldown.get(b)).slice(0, 1);
}

/** Percorre os modelos com nova tentativa para erros transitórios. fn(model) faz a chamada e valida. */
async function withModels(task, allModels, fn, kind = 'text') {
  if (!config.ai.geminiApiKey) throw new AIError('GEMINI_API_KEY não configurada');
  let lastErr;
  const models = usable([...new Set(allModels)]);
  for (const model of models) {
    for (let attempt = 0; attempt <= config.ai.maxRetries; attempt++) {
      const t0 = Date.now();
      try {
        const { result, usage: meta } = await fn(model);
        log('info', 'ok', { task, model, attempt, ms: Date.now() - t0, tokens: meta?.totalTokenCount });
        usage.record({ kind, task, model, usage: meta });
        return result;
      } catch (err) {
        lastErr = err;
        log('warn', err.message, { task, model, attempt, ms: Date.now() - t0 });
        usage.record({ kind, task, model, ok: false, error: err.message });
        if (!err.retryable) break;
        // Modelo inexistente ou sem cota: troca na hora. Sobrecarga (503/429): uma nova tentativa com espera e depois troca.
        if (/quota/i.test(err.message)) { markCooldown(model, err.message); break; }
        if (/Gemini 404/.test(err.message)) break;
        if (/Gemini (503|429)/.test(err.message) && attempt >= 1) break;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  log('error', 'todas as tentativas falharam', { task, error: lastErr?.message });
  throw lastErr || new AIError('Falha na IA');
}

/**
 * Gera uma resposta JSON validada por um schema zod.
 * media: [{ mimeType, data(base64) }] — imagens, PDF ou áudio enviados junto com o prompt.
 */
async function generateJSON({ task, system, prompt, schema, temperature = 0.6, media = [], timeoutMs, fast = false, maxOutputTokens = 8192 }) {
  const parts = [...media.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.data } })), { text: prompt }];
  const models = [...(fast ? config.ai.fastModels : []), config.ai.geminiModel, ...config.ai.geminiFallbackModels];
  return withModels(task, models, async (model) => {
    const body = await post(model, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', temperature, maxOutputTokens },
    }, timeoutMs);
    const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    const parsed = schema.safeParse(extractJSON(text));
    if (!parsed.success) throw new AIError(`Resposta fora do contrato: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`, { retryable: true });
    return { result: parsed.data, usage: body?.usageMetadata };
  }, media.some((m) => String(m.mimeType).startsWith('audio/')) ? 'audio' : 'text');
}

/** Texto → áudio PCM 16-bit mono (24 kHz) pelos modelos TTS do Gemini */
async function synthesizeSpeech({ text, voice, style }) {
  return withModels('tts', config.ai.ttsModels, async (model) => {
    const body = await post(model, {
      contents: [{ parts: [{ text: style ? `${style}: ${text}` : text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }, 45000);
    const data = body?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
    if (!data) throw new AIError('TTS sem áudio', { retryable: true });
    return { result: Buffer.from(data, 'base64'), usage: body?.usageMetadata };
  }, 'audio');
}

module.exports = { generateJSON, synthesizeSpeech, extractJSON, AIError };
