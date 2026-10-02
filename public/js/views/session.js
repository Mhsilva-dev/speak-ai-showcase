// Sala de aula: chat com componentes ricos para aulas estruturadas, conversa livre e roleplay
import { $app, esc, api, go, toast, state, speak, listen, bar, MODE_LABEL, celebrate, confirmDialog } from '../core.js';

import { viewLive } from './live.js';
import { phraseCard } from '../phrase.js';

const CHAT_MODES = ['conversation', 'roleplay', 'live'];

function listenBtn(t) { return t ? `<button class="btn ghost sm" data-say="${esc(t)}">🔊 Ouvir</button>` : ''; }

function renderSummary(m, slug) {
  const p = m.payload || {};
  const chat = CHAT_MODES.includes(p.mode);
  const scores = p.scores ? Object.entries({ grammar: 'Gramática', vocabulary: 'Vocabulário', adequacy: 'Adequação', fluency: 'Fluidez' })
    .map(([k, label]) => `<div class="area"><span>${label}</span>${bar(p.scores[k])}<span class="small">${Math.round(p.scores[k])}</span></div>`).join('') : '';
  return `<div class="card summary stack"><h2>${chat ? (p.mode === 'roleplay' ? 'Cena concluída 🎬' : p.mode === 'live' ? 'Aula de conversação concluída 🎙️' : 'Conversa concluída 💬') : 'Aula concluída 🎉'}</h2>
    ${chat
      ? `<div class="stats">${p.minutes ? `<div class="stat"><b>${p.minutes} min</b><span>de conversa</span></div>` : ''}<div class="stat"><b>${p.turns}</b><span>falas suas</span></div><div class="stat"><b>${p.errorsCorrected}</b><span>correções</span></div></div>${scores}
         ${p.newVocabulary?.length ? `<div><span class="tag">Palavras salvas</span> ${p.newVocabulary.map(esc).join(', ')}</div>` : ''}`
      : `<div class="stats"><div class="stat"><b>${p.accuracy}%</b><span>acertos</span></div>
          <div class="stat"><b>${p.firstTry}/${p.total}</b><span>de primeira</span></div>
          <div class="stat"><b>${p.errorsCorrected}</b><span>erros corrigidos</span></div>
          <div class="stat"><b>${p.newVocabulary}</b><span>palavras novas</span></div></div>
         <div><span class="tag">Você praticou</span> ${esc(p.skill)} · ${esc(p.topic)}</div>`}
    ${p.reviewTomorrow?.length ? `<div><span class="tag">Revisar amanhã</span> ${p.reviewTomorrow.map(esc).join(', ')}</div>` : ''}
    ${p.betterSentences?.length ? `<div><span class="tag">Mais natural</span><ul class="list">${p.betterSentences.map((b) => `<li><span class="strike">${esc(b.original)}</span><br>✅ ${esc(b.better)} ${listenBtn(b.better)}</li>`).join('')}</ul></div>` : ''}
    ${p.levelUp ? `<div class="hint">🚀 Você subiu para o nível <b>${esc(p.levelUp)}</b>!</div>` : ''}
    <p>👩‍🏫 “${esc(m.content)}”</p>
    <a class="btn accent" href="/${slug}" data-link>Voltar ao painel</a></div>`;
}

export function renderMessage(m, slug) {
  const p = m.payload || {};
  switch (m.kind) {
    case 'intro':
      return `<div class="msg teacher"><div class="who">Professor</div>${esc(m.content)}<div class="pt">🇧🇷 ${esc(p.pt)}</div></div>`;
    case 'context':
      return `<div class="msg notice">🇧🇷 ${esc(m.content)}${p.goalPt ? `<div class="small" style="margin-top:4px">🎯 <b>Objetivo:</b> ${esc(p.goalPt)}</div>` : ''}</div>`;
    case 'question':
      return `<div class="msg teacher question"><div class="who">Pergunta ${p.itemIndex + 1} de ${p.total}${p.review === 'vocab' ? ' · 🧩 revisão de palavra' : p.review === 'error' ? ' · 🔁 revisão de erro' : ''}</div>
        <div class="q prewrap">${esc(m.content)}</div>
        ${p.instructionPt ? `<div class="pt">🇧🇷 ${esc(p.instructionPt)}</div>` : ''}<div class="actions">${listenBtn(m.content)}</div></div>`;
    case 'reply':
      return `<div class="msg teacher"><div class="who">Professor</div>${esc(m.content)}<div class="actions">${listenBtn(m.content)}</div></div>`;
    case 'answer':
      return `<div class="msg student">${esc(m.content)}</div>`;
    case 'redirect':
      return `<div class="msg teacher"><div class="who">Professor</div>${esc(m.content)}</div>`;
    case 'correct':
      return `<div class="msg teacher correct"><div class="who">🟢 ${esc(p.praise)}</div>${esc(m.content)}
        ${p.notes?.length ? `<div class="hint small">📝 Detalhe: ${p.notes.map((n) => `<span class="strike">${esc(n.original)}</span> → <b>${esc(n.corrected)}</b>`).join(' · ')}</div>` : ''}
        ${p.phonetic ? `<div class="phon">${esc(p.phonetic)}</div>` : ''}</div>`;
    case 'note':
      return `<div class="msg note small">📝 ${p.notes.map((n) => `<span class="strike">${esc(n.original)}</span> → <b>${esc(n.corrected)}</b>`).join(' · ')}
        ${p.correctedSentence ? `<div class="muted">✅ ${esc(p.correctedSentence)}</div>` : ''}</div>`;
    case 'correction': {
      const ask = p.askRepeat ? (p.corrected ? 'Agora repita a frase completa.' : 'Tente de novo.') : 'Vamos seguir — isso volta na revisão.';
      return `<div class="msg teacher correction"><div class="who">🔴 Correção</div>${esc(m.content)}
        <div class="row"><span class="ico">❌</span><span class="strike">${esc(p.original)}</span></div>
        ${p.errors?.length ? `<div class="row small"><span class="ico"></span><span>${p.errors.map((e) => `<b>${esc(e.original)}</b> → ${p.corrected || !p.askRepeat ? esc(e.corrected) : '?'}`).join(' · ')}</span></div>` : ''}
        ${p.corrected ? `<div class="row"><span class="ico">✅</span><b>${esc(p.corrected)}</b></div>` : ''}
        ${p.phonetic ? `<div class="row"><span class="ico"></span><span class="phon">${esc(p.phonetic)}</span></div>` : ''}
        ${p.explanationPt ? `<div class="row"><span class="ico">🇧🇷</span><span>${esc(p.explanationPt)}</span></div>` : ''}
        ${p.hint ? `<div class="hint">💡 ${esc(p.hint)}</div>` : ''}
        ${p.partial ? `<div class="hint">✍️ Complete: <b>${esc(p.partial)}</b></div>` : ''}
        <div class="pt">${ask}</div>
        ${p.corrected ? `<div class="actions">${listenBtn(p.corrected)}<button class="btn ghost sm" data-mic>🎤 Repetir</button></div>` : ''}</div>`;
    }
    case 'phrase':
      return `<div class="msg teacher"><div class="who">🗣️ Modo fonético</div>${(p.phrases || []).map(phraseCard).join('')}</div>`;
    case 'notice':
      return `<div class="msg notice">${esc(m.content)}</div>`;
    case 'achievement':
      return `<div class="msg notice achievement">${esc(m.content)}<div class="small muted">${esc(p.desc)}</div></div>`;
    case 'summary':
      return renderSummary(m, slug);
    default:
      return `<div class="msg teacher">${esc(m.content)}</div>`;
  }
}

export async function viewSession(slug, id) {
  let s = await api(`/lessons/${id}`);
  if (s.language !== slug) return go(`/${s.language}/aula/${id}`);
  if (s.mode === 'live') return viewLive(slug, s);
  const lang = state.meta.languages.find((l) => l.slug === slug);
  const isChat = CHAT_MODES.includes(s.mode);
  const title = s.mode === 'roleplay' ? `${s.scenario?.emoji || '🎭'} ${s.scenario?.namePt || 'Roleplay'}`
    : s.mode === 'conversation' ? `💬 ${s.topic}` : `${esc(s.skill?.name || MODE_LABEL[s.mode])}`;

  $app.className = '';
  $app.innerHTML = `
    <div class="lesson">
      <div class="lesson-head"><div class="spread">
        <div><b>${lang.flag} ${esc(title)}</b> <span class="muted small">· ${esc(isChat ? MODE_LABEL[s.mode] : `${MODE_LABEL[s.mode]} · ${s.topic}`)}</span></div>
        <div style="display:flex;gap:10px;align-items:center">${isChat ? '<button class="btn ghost sm" id="end">Encerrar</button>' : ''}<a href="/${slug}" class="small muted" data-link>Painel</a></div></div>
        <div id="progress"></div></div>
      <div class="chat" id="chat" aria-live="polite"></div>
      <form class="composer" id="composer">
        <textarea id="answer" rows="1" placeholder="${isChat ? 'Responda em ' + esc(lang.name) + '…' : 'Escreva sua resposta…'}" aria-label="Sua resposta"></textarea>
        <button type="button" class="btn ghost" id="mic" title="Responder falando">🎤</button>
        <button class="btn" id="send">Enviar</button>
      </form>
    </div>`;
  const chat = $app.querySelector('#chat');
  const input = $app.querySelector('#answer');
  const composer = $app.querySelector('#composer');
  let seenAch = new Set(s.messages.filter((m) => m.kind === 'achievement').map((m) => m.id));

  const paint = (busy = false) => {
    $app.querySelector('#progress').innerHTML = isChat
      ? `<div class="small muted" style="margin-top:6px">Turno ${Math.min(s.turns + (s.completed ? 0 : 1), s.targetTurns)} de ${s.targetTurns}</div>${bar((s.turns / s.targetTurns) * 100)}`
      : `<div class="dots">${s.items.map((it) => `<i class="${it.status !== 'pending' ? it.status : it.order_index === s.currentItem && !s.completed ? 'current' : ''}"></i>`).join('')}</div>`;
    chat.innerHTML = s.messages.map((m) => renderMessage(m, slug)).join('') + (busy ? `<div class="typing">${isChat ? 'O professor está respondendo…' : 'O professor está lendo sua resposta…'}</div>` : '');
    composer.hidden = s.completed;
    const end = $app.querySelector('#end'); if (end) end.hidden = s.completed;
    chat.scrollTop = chat.scrollHeight;
  };
  paint();

  const afterUpdate = () => {
    const fresh = s.messages.filter((m) => m.kind === 'achievement' && !seenAch.has(m.id));
    fresh.forEach((m) => seenAch.add(m.id));
    celebrate(fresh.map((m) => m.payload));
    // Lê a nova fala do professor em voz alta nas conversas
    const last = s.messages.at(-1);
    if (isChat && last?.kind === 'reply' && localStorageGet('autoplay') === '1') speak(last.content, slug);
  };

  chat.addEventListener('click', (e) => {
    const say = e.target.closest('[data-say]');
    if (say) speak(say.dataset.say, slug, { button: say });
    if (e.target.closest('[data-mic]')) listen(slug, (t) => { input.value = t; input.focus(); });
  });
  $app.querySelector('#mic').onclick = () => listen(slug, (t) => { input.value = t; input.focus(); });
  $app.querySelector('#end')?.addEventListener('click', async (e) => {
    if (!(await confirmDialog('Encerrar e ver o relatório desta conversa?', { okText: 'Encerrar' }))) return;
    e.target.disabled = true; paint(true);
    try {
      const r = await api(`/conversations/${id}/finish`, { method: 'POST' });
      if (r.discarded) return go(`/${slug}`);
      s = r; paint(); afterUpdate();
    } catch (err) { toast(err.message, { type: 'err' }); e.target.disabled = false; paint(); }
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); composer.requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(140, input.scrollHeight)}px`; });
  composer.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const send = $app.querySelector('#send'); send.disabled = true;
    s.messages.push({ role: 'student', kind: 'answer', content: text });
    input.value = ''; input.style.height = 'auto'; paint(true);
    try {
      s = isChat ? await api(`/conversations/${id}/message`, { body: { text } }) : await api(`/lessons/${id}/answer`, { body: { answer: text } });
      afterUpdate();
    } catch (err) {
      s.messages.pop(); input.value = text; toast(err.message, { type: 'err' });
    }
    send.disabled = false; paint(); if (!s.completed) input.focus();
  };
  input.focus();
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
