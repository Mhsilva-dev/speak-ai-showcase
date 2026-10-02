// Texto → fala. Provedor atual: Gemini TTS. Áudio fica em cache no disco (mesma frase = sem nova chamada).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../../config');
const { synthesizeSpeech } = require('../ai/gemini.service');

const CACHE_DIR = path.join(__dirname, '../../../data/tts');
const inflight = new Map();

function pcmToWav(pcm, sampleRate = 24000, channels = 1, bits = 16) {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bits) / 8;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Retorna o caminho de um WAV com a frase falada. slow = versão mais lenta para iniciantes. */
async function speak({ text, lang, slow = false, voice }) {
  voice = voice || lang.ttsVoice;
  if (config.ai.provider === 'mock') throw new Error('TTS indisponível em teste');
  const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 400);
  const key = crypto.createHash('sha1').update(`${lang.code}|${voice}|${slow}|${clean}`).digest('hex');
  const file = path.join(CACHE_DIR, `${key}.wav`);
  if (fs.existsSync(file)) {
    const t = new Date();
    fs.utimes(file, t, t, () => {}); // marca como usado (a limpeza apaga os parados há muito tempo)
    return file;
  }
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    const style = `Read aloud in a clear, ${slow ? 'slow and very well-articulated' : 'natural'} ${lang.code === 'es' ? 'Spanish' : 'American English'} teacher voice`;
    const pcm = await synthesizeSpeech({ text: clean, voice, style });
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, pcmToWav(pcm));
    fs.renameSync(tmp, file);
    return file;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

// Limpeza do cache: qualquer aluno pode pedir frases novas, então o disco não pode crescer sem limite.
// Apaga áudios sem uso há 60 dias e, se ainda passar de 1 GB, os mais antigos primeiro.
const MAX_AGE_MS = 60 * 86400000;
const MAX_BYTES = 1024 ** 3;
function prune() {
  if (!fs.existsSync(CACHE_DIR)) return { removed: 0 };
  const now = Date.now();
  let removed = 0;
  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.wav')).map((f) => {
    const full = path.join(CACHE_DIR, f);
    const st = fs.statSync(full);
    return { full, size: st.size, used: Math.max(st.atimeMs, st.mtimeMs) };
  }).sort((a, b) => a.used - b.used);
  let total = files.reduce((t, f) => t + f.size, 0);
  for (const f of files) {
    if (now - f.used < MAX_AGE_MS && total <= MAX_BYTES) break;
    try { fs.unlinkSync(f.full); total -= f.size; removed++; } catch { /* já apagado */ }
  }
  return { removed };
}

/** Roda a limpeza agora e depois 1x por dia */
function schedulePrune() {
  if (config.env === 'test') return;
  const run = () => { try { const r = prune(); if (r.removed) console.log(`cache de áudio: ${r.removed} arquivo(s) removido(s)`); } catch (e) { console.error('cache de áudio', e.message); } };
  run();
  setInterval(run, 86400000).unref();
}

module.exports = { speak, pcmToWav, prune, schedulePrune };
