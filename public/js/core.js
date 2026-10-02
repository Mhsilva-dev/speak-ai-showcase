// Utilidades compartilhadas: API, navegação, toasts, áudio (voz do professor + gravação em WAV).
export const $app = document.getElementById('app');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const SPEECH_LANG = { english: 'en-US', spanish: 'es-ES', pt: 'pt-BR' };
export const AREA_LABEL = { speaking: 'Speaking', grammar: 'Grammar', vocabulary: 'Vocabulary', listening: 'Listening', pronunciation: 'Pronunciation' };
export const MODE_LABEL = { lesson: 'Aula', daily: 'Aula do dia', words: 'Palavras', material: 'Material', conversation: 'Conversa', roleplay: 'Roleplay', live: 'Aula ao vivo' };
export const state = { meta: null, me: null };

let navigate = () => {};
export function setNavigator(fn) { navigate = fn; }
export function go(path) { history.pushState({}, '', path); navigate(); }

export async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body && !isForm ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) { state.me = null; go('/login'); throw new Error('Faça login'); }
  if (!res.ok) throw new Error(data.error || 'Algo deu errado');
  return data;
}

// Aviso rápido. toast(msg), toast(msg, 6000) ou toast(msg, { type: 'ok' | 'err' | 'info' | 'win', ms })
const TOAST_ICON = { ok: 'check', err: 'x', info: 'guide', win: 'flame' };
export function toast(msg, opts = {}) {
  const { type = 'info', ms = 4000 } = typeof opts === 'number' ? { ms: opts } : opts;
  const t = document.getElementById('toast');
  t.className = `toast ${type}`;
  t.setAttribute('role', type === 'err' ? 'alert' : 'status');
  t.style.setProperty('--ms', `${ms}ms`);
  t.innerHTML = `<span class="toast-ic">${icon(TOAST_ICON[type] || 'guide', 16)}</span><span class="toast-msg">${esc(msg)}</span><i class="toast-bar"></i>`;
  t.hidden = false;
  void t.offsetWidth; t.classList.add('in');
  const hide = () => { t.classList.remove('in'); clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 200); };
  t.onclick = hide;
  clearTimeout(toast.t); clearTimeout(toast.h); toast.t = setTimeout(hide, ms);
}

// Diálogo no visual do app (substitui confirm/prompt nativos). Resolve true/false, ou o texto digitado (null se cancelar).
function dialog({ message, input, okText = 'Confirmar', cancelText = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const el = document.createElement('div');
    el.className = 'dlg-backdrop';
    el.innerHTML = `<div class="dlg card" role="dialog" aria-modal="true">
      <p class="dlg-msg">${esc(message)}</p>
      ${input ? `<input class="dlg-input" type="${input.type || 'text'}" placeholder="${esc(input.placeholder || '')}" autocomplete="off">` : ''}
      <div class="dlg-actions">
        <button class="btn ghost" data-r="0">${esc(cancelText)}</button>
        <button class="btn ${danger ? 'danger' : 'accent'}" data-r="1">${esc(okText)}</button>
      </div></div>`;
    const field = el.querySelector('.dlg-input');
    const close = (ok) => {
      document.removeEventListener('keydown', onKey, true);
      el.classList.add('out');
      setTimeout(() => el.remove(), 150);
      prev?.focus?.();
      resolve(input ? (ok ? field.value : null) : ok);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'Enter' && field && document.activeElement === field) { e.preventDefault(); close(true); }
    };
    el.addEventListener('click', (e) => { if (e.target === el) close(false); });
    el.querySelectorAll('[data-r]').forEach((b) => { b.onclick = () => close(b.dataset.r === '1'); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(el);
    (field || el.querySelector('[data-r="1"]')).focus();
  });
}
export const confirmDialog = (message, opts = {}) => dialog({ message, ...opts });
export const promptDialog = (message, opts = {}) => dialog({ message, input: opts.input || {}, okText: 'OK', ...opts });

export function celebrate(achievements = []) {
  achievements.forEach((a, i) => setTimeout(() => toast(`${a.icon} Conquista: ${a.name}`, { type: 'win', ms: 3500 }), i * 3600));
}

const ICONS = {
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  home: '<path d="M3 11 12 4l9 7v9H3z"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
  micoff: '<path d="M3 3l18 18M9 9v3a3 3 0 0 0 5 2.2M15 9.3V5a3 3 0 0 0-5.7-1.3"/><path d="M19 10v2a7 7 0 0 1-.9 3.4M5 10v2a7 7 0 0 0 11.4 5.4M12 19v3"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  guide: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  mask: '<path d="M4 5h16v6a8 8 0 0 1-16 0z"/><path d="M9 10h.01M15 10h.01M9 14c1.5 1.3 4.5 1.3 6 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  cards: '<rect x="3" y="6" width="14" height="14" rx="3"/><path d="M7 3h11a3 3 0 0 1 3 3v11"/>',
  wave: '<path d="M3 12h2l2-6 4 12 3-9 2 3h5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  flame: '<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4 1-6 1-9z"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  speaker: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  pen: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  headset: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M21 15a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2zM3 15a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  book: '<path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 8h6"/>',
};
export const icon = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
export const play = (size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>`;
export const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };

/** Anel de progresso (SVG) */
export function ring(pct, size = 112, label = '', sub = '') {
  const c = 301.6, off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" viewBox="0 0 112 112" aria-hidden="true"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF9466"/><stop offset=".5" stop-color="#F0567A"/><stop offset="1" stop-color="#9A86FF"/></linearGradient></defs><circle cx="56" cy="56" r="48" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="9"/><circle cx="56" cy="56" r="48" fill="none" stroke="url(#rg)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 56 56)"/></svg><div class="ring-in"><b>${label}</b><span>${sub}</span></div></div>`;
}

export const bar = (pct) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;

/** As seções agora ficam no menu lateral (computador) e na barra inferior (celular) — ver app.js */
export function langNav() { return ''; }

// ---------- Áudio
let currentAudio = null;
const ttsCache = new Map();

function browserSpeak(text, slug, slow) {
  if (!('speechSynthesis' in window)) return toast('Seu navegador não tem áudio disponível', { type: 'err' });
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = SPEECH_LANG[slug] || 'en-US'; u.rate = slow ? 0.7 : 0.92;
  speechSynthesis.speak(u);
}

/** Voz do professor (Gemini TTS, com cache). Se falhar, usa a voz do navegador. */
export async function speak(text, slug, { slow = false, button, voice } = {}) {
  const key = `${slug}|${voice || ''}|${slow}|${text}`;
  try {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    if (button) button.classList.add('loading');
    let url = ttsCache.get(key);
    if (!url) {
      const res = await fetch(`/api/languages/${slug}/tts?text=${encodeURIComponent(text)}${slow ? '&slow=1' : ''}${voice ? `&voice=${voice}` : ''}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('tts');
      url = URL.createObjectURL(await res.blob());
      ttsCache.set(key, url);
    }
    currentAudio = new Audio(url);
    await currentAudio.play();
  } catch {
    browserSpeak(text, slug, slow);
  } finally {
    if (button) button.classList.remove('loading');
  }
}

/** Reconhecimento de fala do navegador (para ditar a resposta no chat) */
export function listen(slug, onText) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Ditado por voz não suportado neste navegador (use o Chrome)', { type: 'err' });
  const r = new SR();
  r.lang = SPEECH_LANG[slug] || 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
  r.onresult = (e) => onText(e.results[0][0].transcript);
  r.onerror = () => toast('Não consegui ouvir. Tente de novo.', { type: 'err' });
  r.start();
  toast('🎤 Ouvindo…', 2500);
}

function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([v], { type: 'audio/wav' });
}

/** Grava o microfone e devolve um WAV mono 16 kHz (formato aceito por qualquer provedor de fala). */
export async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Gravação não suportada neste navegador');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(proc); proc.connect(ctx.destination);
  const started = Date.now();
  return {
    async stop() {
      proc.disconnect(); source.disconnect(); stream.getTracks().forEach((t) => t.stop());
      const rate = ctx.sampleRate; await ctx.close();
      const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
      let off = 0; for (const c of chunks) { all.set(c, off); off += c.length; }
      // reamostra para 16 kHz
      const ratio = rate / 16000;
      const out = new Float32Array(Math.floor(all.length / ratio));
      for (let i = 0; i < out.length; i++) out[i] = all[Math.floor(i * ratio)];
      return { blob: encodeWav(out, 16000), seconds: (Date.now() - started) / 1000 };
    },
  };
}

/** Botão "segure/clique para gravar": alterna gravação e chama onDone(blob) */
export function recorderButton(btn, onDone) {
  let rec = null;
  btn.addEventListener('click', async () => {
    if (!rec) {
      try { rec = await startRecording(); } catch (e) { return toast(e.name === 'NotAllowedError' ? 'Permita o acesso ao microfone' : e.message, { type: 'err' }); }
      btn.classList.add('recording'); btn.dataset.label = btn.innerHTML; btn.innerHTML = 'Parar';
      rec.timer = setTimeout(() => btn.click(), 15000);
    } else {
      clearTimeout(rec.timer);
      const r = rec; rec = null;
      btn.classList.remove('recording'); btn.innerHTML = btn.dataset.label;
      const { blob, seconds } = await r.stop();
      if (seconds < 0.6) return toast('Gravação muito curta', { type: 'err' });
      onDone(blob);
    }
  });
}
