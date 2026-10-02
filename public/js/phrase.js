// Cartão de frase com MODO FONÉTICO: ler (pronúncia aproximada + IPA), ouvir, ouvir devagar, gravar e salvar
import { esc, api, toast, speak, recorderButton, celebrate, icon } from './core.js';
import { pronResult } from './views/pronunciation.js';

export function phraseCard(p) {
  return `<div class="phrase" data-text="${esc(p.text)}">
    <div class="ph-text">${esc(p.text)}</div>
    ${p.br ? `<div class="ph-br" title="Pronúncia aproximada"><span>LEIA ASSIM</span><b>${esc(p.br)}</b></div>` : ''}
    ${p.translation ? `<div class="ph-tr">${esc(p.translation)}</div>` : ''}
    ${p.ipa ? `<div class="phon">${esc(p.ipa)}</div>` : ''}
    ${p.tip ? `<div class="small ph-tip">${esc(p.tip)}</div>` : ''}
    <div class="actions">
      <button class="act" data-ph="say">${icon('speaker', 16)} Ouvir</button>
      <button class="act" data-ph="slow">Devagar</button>
      <button class="act hot" data-ph="rec">${icon('mic', 16)} Falar</button>
      <button class="act" data-ph="save" data-tr="${esc(p.translation || '')}" data-ipa="${esc(p.ipa || '')}">${icon('plus', 16)} Salvar</button>
    </div>
    <div class="ph-result"></div>
  </div>`;
}

/** Liga os botões de todos os cartões dentro de root (idempotente) */
export function bindPhrases(root, lang) {
  root.querySelectorAll('.phrase:not([data-bound])').forEach((card) => {
    card.dataset.bound = '1';
    const text = card.dataset.text;
    card.querySelector('[data-ph="say"]').onclick = (e) => speak(text, lang.slug, { button: e.currentTarget });
    card.querySelector('[data-ph="slow"]').onclick = (e) => speak(text, lang.slug, { slow: true, button: e.currentTarget });
    const save = card.querySelector('[data-ph="save"]');
    save.onclick = async () => {
      save.disabled = true;
      try {
        await api(`/languages/${lang.slug}/vocabulary`, { body: { word: text, translation: save.dataset.tr || null, pronunciation: save.dataset.ipa || null } });
        save.textContent = 'Salvo'; toast('Salvo no seu vocabulário — vai aparecer nos flashcards', { type: 'ok' });
      } catch (err) { toast(err.message, { type: 'err' }); save.disabled = false; }
    };
    const box = card.querySelector('.ph-result');
    recorderButton(card.querySelector('[data-ph="rec"]'), async (blob) => {
      box.innerHTML = '<p class="muted small">Ouvindo sua pronúncia…</p>';
      const fd = new FormData();
      fd.append('audio', blob, 'fala.wav'); fd.append('text', text.slice(0, 300));
      try {
        const r = await api(`/languages/${lang.slug}/pronunciation/assess`, { body: fd });
        box.innerHTML = pronResult(r);
        box.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => speak(b.dataset.say, lang.slug, { slow: true, button: b }); });
        celebrate(r.achievements);
      } catch (err) { box.innerHTML = ''; toast(err.message, { type: 'err' }); }
    });
  });
}
