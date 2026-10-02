// Pronúncia: sons difíceis para brasileiros, shadowing (ouvir → gravar → análise) e ditado (listening)
import { $app, esc, api, toast, langNav, speak, recorderButton, celebrate } from '../core.js';

export async function viewPronunciation(lang) {
  const data = await api(`/languages/${lang.slug}/pronunciation`);
  const stats = Object.fromEntries(data.stats.map((s) => [s.module, s]));
  let tab = location.hash === '#ditado' ? 'listening' : 'sounds';
  let current = data.modules.find((m) => `#${m.code}` === location.hash) || null;

  function render() {
    $app.innerHTML = `
      ${langNav(lang, 'pronuncia')}
      <div class="stack">
        <div><h1>🎤 Pronúncia & Listening</h1><p class="muted small">A voz do professor é gerada por IA; a análise da sua fala compara o que foi ouvido com a frase.</p></div>
        <div class="tabs"><button data-tab="sounds" class="${tab === 'sounds' ? 'on' : ''}">Sons e shadowing</button><button data-tab="listening" class="${tab === 'listening' ? 'on' : ''}">Ditado (listening)</button></div>
        <div id="body"></div>
      </div>`;
    $app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; current = null; render(); }; });
    if (tab === 'listening') return dictation($app.querySelector('#body'), lang, data.listening);
    if (current) return module($app.querySelector('#body'), lang, current, () => { current = null; history.replaceState({}, '', location.pathname); render(); });
    $app.querySelector('#body').innerHTML = `<div class="scenarios">${data.modules.map((m) => {
      const s = stats[m.code];
      return `<button class="card scenario" data-m="${m.code}"><span class="ipa">${esc(m.ipa)}</span><b>${esc(m.title)}</b>
        <small>${s ? `média ${s.avg}% · ${s.attempts} tentativa(s)` : 'ainda não praticado'}</small></button>`;
    }).join('')}</div>`;
    $app.querySelectorAll('[data-m]').forEach((b) => {
      b.onclick = () => { current = data.modules.find((m) => m.code === b.dataset.m); history.replaceState({}, '', `#${current.code}`); render(); };
    });
  }
  render();
}

function module(el, lang, m, back) {
  el.innerHTML = `
    <div class="stack">
      <button class="btn ghost sm" id="back" style="align-self:flex-start">← Todos os sons</button>
      <section class="card stack">
        <div class="spread"><h2 style="margin:0">${esc(m.title)} <span class="ipa">${esc(m.ipa)}</span></h2></div>
        <div class="howto">
          <div><span>👅</span><b>Língua</b><p>${esc(m.how.tongue)}</p></div>
          <div><span>🦷</span><b>Dentes</b><p>${esc(m.how.teeth)}</p></div>
          <div><span>💨</span><b>Ar</b><p>${esc(m.how.air)}</p></div>
          <div><span>🔊</span><b>Voz</b><p>${esc(m.how.voice)}</p></div>
        </div>
        <div class="hint">🇧🇷 ${esc(m.tipBr)}</div>
        <div><b class="small">Palavras</b><div class="chips" style="margin-top:6px">${m.words.map((w) => `<button class="chip" data-say="${esc(w)}">🔊 ${esc(w)}</button>`).join('')}</div></div>
      </section>
      <section class="stack"><h2>Shadowing</h2><p class="muted small">Ouça, depois grave você repetindo a frase inteira.</p>
        ${[...m.sentences, ...m.words.slice(0, 3)].map((s, i) => `
          <div class="card shadow" data-i="${i}">
            <div class="q">${esc(s)}</div>
            <div class="actions"><button class="btn ghost sm" data-say="${esc(s)}">🔊 Ouvir</button><button class="btn ghost sm" data-slow="${esc(s)}">🐢 Devagar</button>
              <button class="btn sm rec" data-text="${esc(s)}">🎤 Gravar</button></div>
            <div class="result"></div>
          </div>`).join('')}
      </section>
    </div>`;
  el.querySelector('#back').onclick = back;
  el.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => speak(b.dataset.say, lang.slug, { button: b }); });
  el.querySelectorAll('[data-slow]').forEach((b) => { b.onclick = () => speak(b.dataset.slow, lang.slug, { slow: true, button: b }); });
  el.querySelectorAll('.rec').forEach((btn) => {
    const box = btn.closest('.shadow').querySelector('.result');
    recorderButton(btn, async (blob) => {
      box.innerHTML = '<p class="muted small">Analisando sua pronúncia…</p>';
      const fd = new FormData();
      fd.append('audio', blob, 'fala.wav'); fd.append('text', btn.dataset.text); fd.append('module', m.code);
      try {
        const r = await api(`/languages/${lang.slug}/pronunciation/assess`, { body: fd });
        box.innerHTML = pronResult(r);
        box.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => speak(b.dataset.say, lang.slug, { slow: true, button: b }); });
        celebrate(r.achievements);
      } catch (err) { box.innerHTML = ''; toast(err.message, { type: 'err' }); }
    });
  });
}

export function pronResult(r) {
  const cls = r.score >= 85 ? 'ok' : r.score >= 65 ? 'mid' : 'bad';
  return `<div class="pronres">
    <div class="score ${cls}">${r.score}%</div>
    <div class="stack" style="flex:1">
      <div>${r.words.map((w) => `<span class="pw ${w.ok ? 'ok' : 'bad'}" ${w.issuePt ? `title="${esc(w.issuePt)}"` : ''}>${esc(w.word)}</span>`).join(' ')}</div>
      <div class="small muted">Ouvi: “${esc(r.transcript)}”</div>
      ${r.problems.length ? `<div class="small">${r.problems.map((p) => `<div>⚠️ <b>${esc(p.word)}</b>${p.issuePt ? ` — ${esc(p.issuePt)}` : ''} <button class="btn ghost sm" data-say="${esc(p.word)}">🔊</button></div>`).join('')}</div>` : ''}
      <div>👩‍🏫 ${esc(r.feedbackTarget)}</div>
      ${r.tipPt ? `<div class="hint small">💡 ${esc(r.tipPt)}</div>` : ''}
    </div></div>`;
}

function dictation(el, lang, { level, sentences }) {
  let i = 0;
  const show = () => {
    const text = sentences[i % sentences.length];
    el.innerHTML = `
      <div class="card stack" style="max-width:620px">
        <div class="spread"><span class="muted small">Ditado ${level} · frase ${(i % sentences.length) + 1} de ${sentences.length}</span></div>
        <p>Ouça e escreva exatamente o que ouvir.</p>
        <div class="actions"><button class="btn" id="play">🔊 Ouvir</button><button class="btn ghost" id="slow">🐢 Devagar</button></div>
        <form id="f" class="stack"><input id="typed" autocomplete="off" placeholder="Escreva o que ouviu…" aria-label="O que você ouviu">
          <button class="btn accent">Conferir</button></form>
        <div id="res"></div>
      </div>`;
    el.querySelector('#play').onclick = (e) => speak(text, lang.slug, { button: e.target });
    el.querySelector('#slow').onclick = (e) => speak(text, lang.slug, { slow: true, button: e.target });
    el.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      const typed = el.querySelector('#typed').value;
      if (!typed.trim()) return;
      try {
        const r = await api(`/languages/${lang.slug}/listening/check`, { body: { text, typed } });
        el.querySelector('#res').innerHTML = `<div class="pronres"><div class="score ${r.score >= 85 ? 'ok' : r.score >= 60 ? 'mid' : 'bad'}">${r.score}%</div>
          <div class="stack" style="flex:1"><div>${r.words.map((w) => `<span class="pw ${w.ok ? 'ok' : 'bad'}">${esc(w.word)}</span>`).join(' ')}</div>
          <div class="small muted">Frase: “${esc(r.text)}”</div><button class="btn sm" id="next">Próxima frase →</button></div></div>`;
        el.querySelector('#next').onclick = () => { i++; show(); };
        celebrate(r.achievements);
      } catch (err) { toast(err.message, { type: 'err' }); }
    };
    el.querySelector('#typed').focus();
  };
  show();
}
