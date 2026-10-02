// Aula de conversação por VOZ, ao vivo (estilo modo de voz do ChatGPT/Gemini):
// você fala, o professor responde falando na hora. Sem caixa de texto, sem precisar enviar nada.
import { $app, esc, api, go, toast, state, celebrate, icon, confirmDialog } from '../core.js';
import { LiveAudio } from '../live-audio.js';
import { renderMessage } from './session.js';
import { teacherStrip, bindTeacherStrip } from './teachers.js';
import { phraseCard, bindPhrases } from '../phrase.js';
import { mountTutor } from './tutor.js';

// Microfone aberto no clique de "Começar" (gesto do usuário) e entregue à sala — assim a aula começa sozinha
let pendingAudio = null;

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignora */ } };

async function openMic() {
  const a = new LiveAudio({ onChunk: () => {}, onLevel: () => {} });
  await a.start();
  return a;
}

export async function viewLiveSetup(lang) {
  const d = await api(`/languages/${lang.slug}/dashboard`);
  let choice = { topic: 'surprise' };
  $app.innerHTML = `
    <div class="stack">
      <section class="live-hero">
        <div class="orb-wrap"><i class="sphere xl"></i></div>
        <div><span class="eyebrow violet">AO VIVO</span><h1>Conversação por voz</h1>
        <p class="muted">Converse falando com o professor, como numa ligação: você fala, ele responde na hora, corrige e continua. Não precisa digitar nem enviar nada, e você pode interromper quando quiser.</p>
        <p class="small muted">Sem fone, o microfone espera o professor terminar de falar. Com fone, ative o ícone de fone na chamada para poder interromper à vontade.</p></div>
      </section>
      ${teacherStrip(lang, d)}
      <section class="card stack">
        <div class="tabs" style="margin:0"><button data-k="topic" class="on">Conversa livre</button><button data-k="scenario">Roleplay</button></div>
        <div id="opts"></div>
        <button class="btn accent big-btn glow" id="go">${icon('mic')} Começar a conversar</button>
        <p class="small muted center" id="vleft"></p>
      </section>
    </div>`;
  const opts = $app.querySelector('#opts');
  const renderOpts = (kind) => {
    const items = kind === 'topic' ? state.meta.topics.map((t) => [t, t]) : state.meta.scenarios.map((s) => [s.id, s.namePt]);
    opts.innerHTML = `<div class="chips"><button type="button" class="chip on" data-v="surprise">Surpreenda-me</button>${items.map(([v, l]) => `<button type="button" class="chip" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
    choice = { [kind]: 'surprise' };
    opts.querySelectorAll('.chip').forEach((c) => {
      c.onclick = () => { opts.querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); c.classList.add('on'); choice = { [kind]: c.dataset.v }; };
    });
  };
  renderOpts('topic');
  api('/voice/remaining').then((v) => {
    if (v.remainingSeconds == null) return;
    const min = Math.floor(v.remainingSeconds / 60);
    const el = $app.querySelector('#vleft');
    if (v.remainingSeconds < 30) {
      el.innerHTML = `Seu tempo de voz de hoje acabou (${v.limit} min por dia). Volte amanhã ou continue pelo chat.`;
      const go = $app.querySelector('#go'); go.disabled = true;
    } else el.textContent = `Você tem ${min} de ${v.limit} min de conversa por voz hoje.`;
  }).catch(() => {});
  bindTeacherStrip($app, lang, () => viewLiveSetup(lang));
  $app.querySelectorAll('[data-k]').forEach((b) => {
    b.onclick = () => { $app.querySelectorAll('[data-k]').forEach((x) => x.classList.remove('on')); b.classList.add('on'); renderOpts(b.dataset.k); };
  });
  $app.querySelector('#go').onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Abrindo o microfone…';
    try {
      pendingAudio = await openMic();
    } catch (err) {
      e.target.disabled = false; e.target.textContent = 'Começar a conversar';
      return toast(err.name === 'NotAllowedError' ? 'Permita o acesso ao microfone para conversar por voz.' : err.message, { type: 'err', ms: 6000 });
    }
    try {
      const s = await api(`/languages/${lang.slug}/live`, { body: choice });
      go(`/${s.language}/aula/${s.id}`);
    } catch (err) {
      await pendingAudio?.stop(); pendingAudio = null;
      toast(err.message, { type: 'err' }); e.target.disabled = false; e.target.textContent = 'Começar a conversar';
    }
  };
}

export function viewLive(slug, lesson) {
  const lang = state.meta.languages.find((l) => l.slug === slug);
  const teacher = state.meta.teachers.find((t) => t.voice === lesson.teacherVoice) || state.meta.teachers[0];
  let s = lesson;
  let ws = null;
  let audio = null;
  let status = 'idle'; // idle | connecting | listening | teacher | muted | ended
  let caption = { who: '', text: '' };
  let showCaptions = lsGet('liveCaptions') === '1';
  let started = 0;
  let timer = null;
  let reconnects = 0;
  let endsAt = null; // fim do tempo de voz de hoje (null = sem limite)
  let ending = false;
  let cardTimer = null;
  let replaced = false; // a conversa foi aberta em outra aba/aparelho
  const subtitle = s.scenario ? s.scenario.namePt : s.topic;

  $app.className = '';
  $app.innerHTML = `
    <div class="voice" id="voice">
      <div class="voice-top">
        <a href="/${slug}" data-link class="voice-x" aria-label="Sair">${icon('back', 18)}</a>
        <div class="center"><b>${esc(teacher.name)}</b><div class="small live-sub"><i class="live-dot"></i>Ao vivo · ${esc(subtitle)} · <span id="clock">0:00</span><span id="left"></span></div></div>
        <button class="voice-x ${lsGet('liveHeadset') === '1' ? 'on' : ''}" id="headset" aria-label="Estou usando fone de ouvido" title="Estou de fone">${icon('headset', 18)}</button>
      </div>
      <div class="voice-center">
        <div class="orb-stage">
          <i class="orbit o1"></i><i class="orbit o2"></i><i class="orbit o3"></i>
          <button class="orb" id="orb" data-state="idle" aria-label="Começar"></button>
          <i class="orb-shadow"></i>
        </div>
        <div class="wave" aria-hidden="true">${[10, 20, 28, 16, 24, 12, 20, 8].map((h, i) => `<i style="--h:${h}px;--i:${i}"></i>`).join('')}</div>
        <div class="orb-status" id="status">Toque para começar</div>
        <div class="live-tr glass" id="tr" hidden></div>
        ${s.scenario ? `<div class="small voice-goal">Objetivo: ${esc(s.scenario.goalPt)}</div>` : ''}
        <div class="caption" id="caption" ${showCaptions ? '' : 'hidden'}></div>
        <div class="live-card-float" id="corr" hidden></div>
        <div class="phrase-float" id="phr"></div>
      </div>
      <div class="voice-controls">
        <button class="vbtn" id="mute" aria-label="Silenciar microfone" disabled><span>${icon('mic', 24)}</span><small>Microfone</small></button>
        <button class="vbtn ${showCaptions ? 'on' : ''}" id="cc" aria-label="Legendas"><span>CC</span><small>Legendas</small></button>
        <button class="vbtn" id="chatbtn" aria-label="Abrir chat"><span>${icon('chat', 24)}</span><small>Chat</small></button>
        <button class="vbtn end" id="end" aria-label="Encerrar aula"><span>${icon('x', 24)}</span><small>Encerrar</small></button>
      </div>
      <div class="voice-chat" id="vchat" hidden></div>
      <div class="voice-report" id="report" hidden></div>
    </div>`;
  const orb = $app.querySelector('#orb');
  const statusEl = $app.querySelector('#status');
  const capEl = $app.querySelector('#caption');
  const trEl = $app.querySelector('#tr');
  let trTurn = null;
  let trParts = [];
  const corrEl = $app.querySelector('#corr');
  const voiceEl = $app.querySelector('#voice');
  const STATUS = {
    idle: 'Toque para começar', replaced: 'Conversa aberta em outra aba ou aparelho. Toque para continuar aqui.', connecting: `Chamando ${teacher.name}…`, listening: 'Pode falar — estou ouvindo',
    teacher: `${teacher.name} está falando…`, muted: 'Microfone desligado', ended: 'Aula encerrada',
  };

  const setStatus = (st) => {
    status = st;
    statusEl.textContent = STATUS[st];
    orb.dataset.state = st; voiceEl.dataset.state = st;
  };

  const paintCaption = () => {
    capEl.hidden = !showCaptions || !caption.text;
    capEl.innerHTML = caption.text ? `<span class="who">${caption.who === 'teacher' ? esc(teacher.name) : 'Você'}:</span> ${esc(caption.text)}` : '';
  };

  // Correção aparece como um cartão flutuante por alguns segundos (o professor também corrige falando)
  const showCorrection = (m) => {
    const p = m.payload || {};
    corrEl.innerHTML = `<span class="eyebrow orange">${icon('pen', 14)}CORREÇÃO</span><div><span class="strike muted">${esc(p.original)}</span></div><div><b>${esc(p.corrected)}</b></div>${p.explanationPt ? `<div class="small muted">${esc(p.explanationPt)}</div>` : ''}`;
    corrEl.hidden = false;
    corrEl.classList.remove('pop'); void corrEl.offsetWidth; corrEl.classList.add('pop');
    clearTimeout(cardTimer); cardTimer = setTimeout(() => { corrEl.hidden = true; }, 9000);
  };

  // Modo fonético: o professor manda a frase para você ler e repetir (fica até você fechar)
  const phrEl = $app.querySelector('#phr');
  const showPhrase = (m) => {
    const wrap = document.createElement('div');
    wrap.className = 'phrase-wrap pop';
    wrap.innerHTML = `<button class="icon ph-close" aria-label="Fechar">${icon('x', 16)}</button>${(m.payload?.phrases || []).map(phraseCard).join('')}`;
    wrap.querySelector('.ph-close').onclick = () => wrap.remove();
    phrEl.prepend(wrap);
    while (phrEl.children.length > 2) phrEl.lastChild.remove();
    bindPhrases(wrap, lang);
  };

  const level = (v, who) => {
    if (status === 'ended') return;
    const lv = Math.min(1, v * (who === 'teacher' ? 2.2 : 3)).toFixed(2);
    orb.style.setProperty('--lvl', lv); voiceEl.style.setProperty('--lvl', lv);
    if (who === 'teacher' && status === 'listening') setStatus('teacher');
  };

  function connect() {
    setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/api/live/${s.id}`);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'ready') {
        if (m.remainingSeconds != null) { endsAt = Date.now() + m.remainingSeconds * 1000; }
        reconnects = 0; setStatus(audio.muted ? 'muted' : 'listening'); $app.querySelector('#mute').disabled = false; }
      else if (m.type === 'audio') { audio.play(m.data); if (status === 'listening') setStatus('teacher'); }
      else if (m.type === 'partial') {
        caption = { who: m.role, text: m.text }; paintCaption();
        if (m.role === 'teacher' && m.turn !== trTurn) { trTurn = m.turn; trParts = []; trEl.hidden = true; } // nova fala: some a tradução antiga
      } else if (m.type === 'translation') {
        // A tradução chega frase por frase enquanto o professor fala
        if (m.turn !== trTurn) { trTurn = m.turn; trParts = []; }
        trParts[m.seq] = m.text;
        trEl.innerHTML = `<span>Tradução</span>${esc(trParts.filter(Boolean).join(' '))}`; trEl.hidden = false;
      }
      else if (m.type === 'message') {
        s.messages.push(m.message);
        if (m.message.kind === 'correction') showCorrection(m.message);
        if (m.message.kind === 'phrase') showPhrase(m.message);
      } else if (m.type === 'interrupted') { audio.stopPlayback(); setStatus(audio.muted ? 'muted' : 'listening'); }
      else if (m.type === 'turnComplete') { setTimeout(() => { if (status === 'teacher' && !audio.speaking) setStatus(audio.muted ? 'muted' : 'listening'); }, 300); }
      else if (m.type === 'replaced') { replaced = true; audio?.stopPlayback(); audio?.stop(); audio = null; setStatus('idle'); statusEl.textContent = STATUS.replaced; }
      else if (m.type === 'notice') toast(m.text);
      else if (m.type === 'limit') { toast(m.text); finish(); }
      else if (m.type === 'error') toast(m.error, { type: 'err', ms: 6000 });
    };
    ws.onclose = () => {
      if (ending || status === 'ended' || replaced) return;
      if (reconnects < 3) { reconnects++; setStatus('connecting'); setTimeout(connect, 800 * reconnects); }
      else { toast('A conexão caiu. Toque na bolha para tentar de novo.', { type: 'err' }); setStatus('idle'); }
    };
  }

  const speakingWatch = setInterval(() => {
    if (status === 'teacher' && audio && !audio.speaking) setStatus(audio.muted ? 'muted' : 'listening');
  }, 400);

  async function begin() {
    if (status !== 'idle') return;
    replaced = false;
    try {
      if (!audio) audio = pendingAudio || await openMic();
      pendingAudio = null;
      audio.onChunk = (data) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'audio', data })); };
      audio.onLevel = level;
      audio.echoGuard = lsGet('liveHeadset') !== '1';
      audio.onBargeIn = () => setStatus('listening');
    } catch (e) {
      return toast(e.name === 'NotAllowedError' ? 'Permita o acesso ao microfone para conversar por voz.' : e.message, { type: 'err', ms: 6000 });
    }
    if (!started) {
      started = Date.now();
      timer = setInterval(() => { const sec = Math.floor((Date.now() - started) / 1000); $app.querySelector('#clock').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        if (endsAt) { const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 60000)); $app.querySelector('#left').textContent = ` · restam ${left} min hoje`; }
      }, 1000);
    }
    connect();
  }
  orb.onclick = begin;

  $app.querySelector('#mute').onclick = () => {
    if (!audio) return;
    audio.setMuted(!audio.muted);
    $app.querySelector('#mute').classList.toggle('off', audio.muted);
    $app.querySelector('#mute span').innerHTML = icon(audio.muted ? 'micoff' : 'mic', 24);
    if (audio.muted && ws?.readyState === 1) ws.send(JSON.stringify({ type: 'audioEnd' }));
    setStatus(audio.muted ? 'muted' : 'listening');
  };
  $app.querySelector('#headset').onclick = (e) => {
    const on = lsGet('liveHeadset') !== '1';
    lsSet('liveHeadset', on ? '1' : '0');
    e.currentTarget.classList.toggle('on', on);
    if (audio) audio.echoGuard = !on;
    toast(on ? 'Modo fone: você pode falar por cima do professor a qualquer momento.' : 'Modo sem fone: o microfone espera o professor terminar de falar (fale alto para interromper).', 5000);
  };
  $app.querySelector('#cc').onclick = (e) => {
    showCaptions = !showCaptions; lsSet('liveCaptions', showCaptions ? '1' : '0');
    e.currentTarget.classList.toggle('on', showCaptions); paintCaption();
  };

  // Chat dentro da conversa por voz: mandar foto, frase, pedir ajuda (com modo fonético) sem sair da chamada
  let chatMounted = null;
  const vchat = $app.querySelector('#vchat');
  $app.querySelector('#chatbtn').onclick = async () => {
    vchat.hidden = !vchat.hidden;
    $app.querySelector('#chatbtn').classList.toggle('on', !vchat.hidden);
    $app.querySelector('#voice').classList.toggle('chat-open', !vchat.hidden);
    if (!vchat.hidden && !chatMounted) {
      vchat.innerHTML = '<p class="muted center" style="padding:20px">Abrindo o chat…</p>';
      try {
        chatMounted = await mountTutor(vchat, lang, { compact: true, onClose: () => { vchat.hidden = true; $app.querySelector('#chatbtn').classList.remove('on'); $app.querySelector('#voice').classList.remove('chat-open'); } });
      } catch (e) { toast(e.message, { type: 'err' }); vchat.hidden = true; }
    }
    if (!vchat.hidden) chatMounted?.focus();
  };

  async function cleanup() {
    clearInterval(timer); clearInterval(speakingWatch);
    window.removeEventListener('popstate', cleanup);
    document.removeEventListener('click', leave, true);
    try { ws?.close(); } catch { /* ok */ }
    await audio?.stop(); audio = null;
  }

  async function finish() {
    if (ending) return;
    ending = true;
    setStatus('ended');
    await cleanup();
    statusEl.textContent = 'Preparando seu relatório…';
    await new Promise((r) => setTimeout(r, 700)); // espera as últimas falas serem gravadas
    try {
      const r = await api(`/conversations/${s.id}/finish`, { method: 'POST' });
      if (r.discarded) return go(`/${slug}`);
      s = r;
      showReport();
      celebrate(s.messages.filter((m) => m.kind === 'achievement').map((m) => m.payload));
    } catch (e) { toast(e.message, { type: 'err' }); ending = false; }
  }

  function showReport() {
    $app.querySelector('#voice').classList.add('done');
    const rep = $app.querySelector('#report');
    const summary = s.messages.filter((m) => m.kind === 'summary').at(-1);
    const transcript = s.messages.filter((m) => ['reply', 'answer', 'correction', 'phrase'].includes(m.kind));
    rep.innerHTML = `${summary ? renderMessage(summary, slug) : ''}
      <details class="card"><summary><b>Ver a conversa escrita</b> <span class="muted small">(${transcript.filter((m) => m.kind === 'answer').length} falas suas)</span></summary>
        <div class="chat static">${transcript.map((m) => renderMessage(m, slug)).join('')}</div></details>`;
    rep.hidden = false;
    bindPhrases(rep, lang);
  }

  $app.querySelector('#end').onclick = async () => {
    if (!started || s.completed) return go(`/${slug}`);
    if (await confirmDialog('Encerrar a conversa e ver o relatório?', { okText: 'Encerrar' })) finish();
  };
  // Saiu sem encerrar: fecha microfone e conexão (a sessão continua para retomar depois)
  function leave(e) { if (e.target.closest('a[data-link]') && !ending) cleanup(); }
  window.addEventListener('popstate', cleanup);
  document.addEventListener('click', leave, true);

  if (s.completed) showReport();
  else if (pendingAudio) begin(); // veio do botão "Começar": já entra conversando
}
