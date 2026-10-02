// Vocabulário: lista, adicionar, marcar difícil, remover, flashcards e "estudar estas palavras hoje"
import { $app, esc, api, toast, langNav, speak, celebrate, confirmDialog } from '../core.js';
import { startActivity } from './dashboard.js';

export async function viewVocab(lang) {
  let filter = 'all';
  let q = '';
  const selected = new Set();

  async function load() {
    const data = await api(`/languages/${lang.slug}/vocabulary?filter=${filter}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    render(data);
  }

  function render({ words, counts }) {
    $app.innerHTML = `
      ${langNav(lang, 'vocabulario')}
      <div class="stack">
        <div class="spread wrap"><div><h1>🧩 Vocabulário</h1>
          <p class="muted small">${counts.total} palavras · ${counts.mastered} dominadas · revisão em 1, 3, 7, 14 e 30 dias</p></div>
          <button class="btn accent" id="review" ${counts.due ? '' : 'disabled'}>${counts.due ? `Revisar ${counts.due} agora` : 'Nada para revisar hoje ✅'}</button></div>
        <form class="card row-form" id="add"><input id="word" placeholder="Adicionar palavra ou expressão em ${esc(lang.name)}…" maxlength="80" aria-label="Nova palavra" required>
          <button class="btn">Adicionar</button></form>
        <div class="spread wrap">
          <div class="chips">${[['all', `Todas (${counts.total})`], ['due', `Para revisar (${counts.due})`], ['difficult', `Difíceis (${counts.difficult})`]]
            .map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
          <input id="q" placeholder="Buscar…" value="${esc(q)}" style="max-width:200px" aria-label="Buscar">
        </div>
        <div id="sel" class="card selbar" hidden><span id="selcount"></span><button class="btn accent sm" id="study">Estudar estas palavras hoje</button></div>
        ${words.length ? `<div class="words">${words.map((w) => `
          <div class="card word ${w.difficult ? 'difficult' : ''}">
            <div class="spread"><label class="check"><input type="checkbox" data-sel="${w.id}" ${selected.has(w.id) ? 'checked' : ''}>
              <b class="w">${esc(w.word)}</b></label>
              <div class="wactions"><button class="icon" data-say="${esc(w.word)}" title="Ouvir">🔊</button>
                <button class="icon" data-diff="${w.id}" title="${w.difficult ? 'Desmarcar difícil' : 'Marcar como difícil'}">${w.difficult ? '⭐' : '☆'}</button>
                <button class="icon" data-del="${w.id}" title="Remover">🗑️</button></div></div>
            ${w.pronunciation ? `<div class="phon">${esc(w.pronunciation)}</div>` : ''}
            <div>${esc(w.translation || '—')}</div>
            ${w.meaning ? `<div class="muted small">${esc(w.meaning)}</div>` : ''}
            ${(w.examples || []).slice(0, 2).map((ex) => `<div class="small ex">“${esc(ex)}”</div>`).join('')}
            <div class="small muted" style="margin-top:6px">${bar(w.mastery)} domínio ${w.mastery}% · ${new Date(w.next_review) <= new Date() ? 'revisar hoje' : `próxima revisão ${new Date(w.next_review).toLocaleDateString('pt-BR')}`}</div>
          </div>`).join('')}</div>` : '<p class="muted center">Nenhuma palavra aqui ainda. As palavras novas das aulas entram automaticamente.</p>'}
      </div>`;
    bind();
    updateSel();
  }

  function bar(p) { return `<span class="minibar"><i style="width:${p}%"></i></span>`; }
  function updateSel() {
    const el = $app.querySelector('#sel');
    el.hidden = !selected.size;
    $app.querySelector('#selcount').textContent = `${selected.size} selecionada(s)`;
  }

  function bind() {
    $app.querySelector('#add').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('.btn'); btn.disabled = true; btn.textContent = 'Buscando…';
      try { const w = await api(`/languages/${lang.slug}/vocabulary`, { body: { word: $app.querySelector('#word').value } }); toast(`“${w.word}” adicionada`, { type: 'ok' }); await load(); }
      catch (err) { toast(err.message, { type: 'err' }); btn.disabled = false; btn.textContent = 'Adicionar'; }
    };
    $app.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { filter = b.dataset.f; load(); }; });
    let t; $app.querySelector('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); load().then(() => $app.querySelector('#q').focus()); }, 350); };
    $app.querySelector('#review').onclick = () => flashcards(lang, load);
    $app.querySelector('#study').onclick = (e) => startActivity(`/languages/${lang.slug}/lessons`, { mode: 'words', wordIds: [...selected] }, e.target, 'Montando a aula com suas palavras…');
    $app.querySelectorAll('[data-sel]').forEach((c) => {
      c.onchange = () => { const id = Number(c.dataset.sel); c.checked ? selected.add(id) : selected.delete(id); if (selected.size > 8) { selected.delete(id); c.checked = false; toast('Escolha até 8 palavras'); } updateSel(); };
    });
    $app.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => speak(b.dataset.say, lang.slug, { button: b }); });
    $app.querySelectorAll('[data-diff]').forEach((b) => {
      b.onclick = async () => { const on = b.textContent === '☆'; await api(`/languages/${lang.slug}/vocabulary/${b.dataset.diff}`, { method: 'PATCH', body: { difficult: on } }); load(); };
    });
    $app.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => { if (!(await confirmDialog('Remover esta palavra?', { okText: 'Remover', danger: true }))) return; await api(`/languages/${lang.slug}/vocabulary/${b.dataset.del}`, { method: 'DELETE' }); selected.delete(Number(b.dataset.del)); load(); };
    });
  }

  await load();
}

async function flashcards(lang, onDone) {
  const { cards } = await api(`/languages/${lang.slug}/vocabulary/review`);
  let i = 0; let right = 0;
  const show = (flipped = false) => {
    if (i >= cards.length) {
      $app.innerHTML = `<div class="card center stack" style="max-width:480px;margin:0 auto"><div style="font-size:2.6rem">🎉</div>
        <h1>Revisão concluída</h1><p>${right} de ${cards.length} lembradas</p><button class="btn accent" id="back">Voltar ao vocabulário</button></div>`;
      $app.querySelector('#back').onclick = onDone;
      return;
    }
    const c = cards[i];
    $app.innerHTML = `
      <div class="stack" style="max-width:520px;margin:0 auto">
        <div class="spread"><span class="muted small">Cartão ${i + 1} de ${cards.length}</span><button class="btn ghost sm" id="quit">Sair</button></div>
        <div class="card flashcard ${flipped ? 'flipped' : ''}" id="card">
          <div class="fw">${esc(c.word)}</div>${c.pronunciation ? `<div class="phon">${esc(c.pronunciation)}</div>` : ''}
          <button class="btn ghost sm" id="say">🔊 Ouvir</button>
          ${flipped ? `<hr><div class="big">${esc(c.translation || '—')}</div>${c.meaning ? `<div class="muted small">${esc(c.meaning)}</div>` : ''}
            ${(c.examples || []).slice(0, 2).map((ex) => `<div class="small ex">“${esc(ex)}”</div>`).join('')}` : '<p class="muted small">Você lembra o significado? Pense e depois vire o cartão.</p>'}
        </div>
        ${flipped ? `<div class="grid2" style="gap:10px"><button class="btn ghost" id="no">😕 Não lembrei</button><button class="btn" id="yes">😄 Lembrei</button></div>`
          : '<button class="btn accent" id="flip">Mostrar resposta</button>'}
      </div>`;
    $app.querySelector('#quit').onclick = onDone;
    $app.querySelector('#say').onclick = (e) => speak(c.word, lang.slug, { button: e.target });
    $app.querySelector('#flip')?.addEventListener('click', () => show(true));
    const answer = async (success) => {
      $app.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        const r = await api(`/languages/${lang.slug}/vocabulary/${c.id}/review`, { body: { success } });
        celebrate(r.achievements);
        if (success) right++;
        i++; show();
      } catch (err) { toast(err.message, { type: 'err' }); $app.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
    };
    $app.querySelector('#yes')?.addEventListener('click', () => answer(true));
    $app.querySelector('#no')?.addEventListener('click', () => answer(false));
  };
  show();
}
