// Chat livre com o professor: pergunte qualquer coisa, mande frases ou fotos; as frases vêm com modo fonético
import { $app, esc, api, toast, state, listen, icon, confirmDialog } from '../core.js';
import { phraseCard, bindPhrases } from '../phrase.js';

const SUGGESTIONS = {
  english: ['Como peço comida num restaurante?', 'Me ensina 5 frases para entrevista de emprego', 'Não consigo falar "thought" e "through", me ajuda', 'Corrige meu texto: I am work in a company since 2020', 'Como falo "estou com saudade" em inglês?'],
  spanish: ['¿Cómo pido comida en un restaurante?', 'Me ensina frases para uma viagem a Buenos Aires', 'Não consigo pronunciar o RR, me ajuda', 'Corrige meu texto: Yo soy cansado hoy', 'Qual a diferença entre "ser" e "estar"?'],
};

// Markdown simples e seguro: **negrito**, listas com "- " e quebras de linha
function md(text) {
  return esc(text).split('\n').map((line) => {
    const l = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<i>$2</i>');
    return /^\s*[-•]\s+/.test(l) ? `<li>${l.replace(/^\s*[-•]\s+/, '')}</li>` : `${l}<br>`;
  }).join('').replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`).replace(/(<br>)+$/, '');
}

function renderMsg(m, threadId, teacher) {
  if (m.kind === 'answer') {
    const img = m.payload?.image ? `<img class="chat-img" src="/api/tutor/${threadId}/image/${m.id}" alt="Imagem enviada" loading="lazy">` : '';
    const text = m.content === '📷 (imagem)' && img ? '' : esc(m.content);
    return `<div class="msg student">${img}${text ? `<div>${text}</div>` : ''}</div>`;
  }
  if (m.kind === 'tutor') {
    const phrases = m.payload?.phrases || [];
    return `<div class="msg teacher tutor"><div class="who"><i class="sphere xs"></i> ${esc(teacher.name)}</div>
      <div class="md">${md(m.content)}</div>
      ${phrases.length ? `<div class="phrases">${phrases.map(phraseCard).join('')}</div>` : ''}</div>`;
  }
  return `<div class="msg notice">${esc(m.content)}</div>`;
}

export async function viewTutor(lang) {
  $app.className = '';
  $app.innerHTML = '<div class="lesson tutor-page" id="tutorRoot"></div>';
  await mountTutor($app.querySelector('#tutorRoot'), lang);
}

/**
 * Monta o chat livre dentro de root. compact = versão em painel (dentro da conversa por voz):
 * sem ditado (o microfone já está na conversa) e com botão de fechar.
 */
export async function mountTutor(root, lang, { compact = false, onClose } = {}) {
  let t = await api(`/languages/${lang.slug}/tutor`);
  const teacher = state.meta.teachers.find((x) => x.voice === t.teacherVoice) || state.meta.teachers[0];
  let image = null;
  const q = (sel) => root.querySelector(sel);

  root.innerHTML = `
      <div class="chat-head">
        ${compact ? '' : `<a href="/${lang.slug}" data-link class="icon-btn plain" aria-label="Voltar ao painel">${icon('back')}</a>`}
        <i class="sphere md"></i>
        <div style="flex:1;min-width:0"><b>${esc(teacher.name)}</b><div class="small muted">${compact ? 'Chat' : 'Chat livre'} · dúvidas, frases e fotos</div></div>
        <button class="icon-btn" data-t="new" aria-label="Nova conversa" title="Nova conversa">${icon('plus', 18)}</button>
        ${compact ? `<button class="icon-btn" data-t="close" aria-label="Fechar chat">${icon('x', 18)}</button>` : ''}
      </div>
      <div class="chat" data-t="chat" aria-live="polite"></div>
      <div data-t="preview" class="img-preview" hidden></div>
      <div class="composer-wrap"><form class="composer pill" data-t="composer">
        <label class="icon-btn plain" title="Enviar foto" aria-label="Enviar foto">${icon('camera')}<input type="file" data-t="file" accept="image/*" hidden></label>
        <textarea data-t="text" rows="1" placeholder="${compact ? 'Pergunte algo ou peça ajuda…' : 'Pergunte qualquer coisa…'}" aria-label="Mensagem"></textarea>
        ${compact ? '' : `<button type="button" class="icon-btn plain" data-t="mic" title="Ditar" aria-label="Ditar">${icon('mic')}</button>`}
        <button class="send" data-t="send" aria-label="Enviar">${icon('arrow', 18)}</button>
      </form></div>`;
  const chat = q('[data-t="chat"]');
  const input = q('[data-t="text"]');
  const preview = q('[data-t="preview"]');

  const paint = (busy = false) => {
    const msgs = t.messages;
    chat.innerHTML = (msgs.length ? '' : `
      <div class="empty-chat stack">
        <div class="center"><i class="sphere xl"></i><h2 style="margin-top:14px">Oi! Sou ${esc(teacher.name)}</h2>
          <p class="muted">Me pergunte qualquer coisa sobre ${esc(lang.namePt.toLowerCase())}: frases que você quer aprender, uma foto de livro ou placa, um texto para corrigir… Se não conseguir falar alguma coisa, é só pedir ajuda que eu te mostro <b>como ler e pronunciar</b>.</p></div>
        <div class="chips center-chips">${(SUGGESTIONS[lang.slug] || SUGGESTIONS.english).map((s) => `<button class="chip" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      </div>`)
      + msgs.map((m) => renderMsg(m, t.id, teacher)).join('')
      + (busy ? `<div class="typing">${esc(teacher.name)} está escrevendo…</div>` : '');
    chat.querySelectorAll('[data-sug]').forEach((b) => { b.onclick = () => { input.value = b.dataset.sug; send(); }; });
    bindPhrases(chat, lang);
    chat.scrollTop = chat.scrollHeight;
  };
  paint();

  const setImage = (file) => {
    image = file || null;
    preview.hidden = !image;
    if (image) {
      const url = URL.createObjectURL(image);
      preview.innerHTML = `<img src="${url}" alt="Pré-visualização"><span class="small">${esc(image.name || 'imagem')}</span><button type="button" class="icon" data-t="rmimg" aria-label="Remover imagem">${icon('x', 16)}</button>`;
      q('[data-t="rmimg"]').onclick = () => setImage(null);
    }
  };
  q('[data-t="file"]').onchange = (e) => {
    const f = e.target.files[0];
    if (f && f.size > 8 * 1024 * 1024) return toast('Imagem maior que 8 MB', { type: 'err' });
    setImage(f); e.target.value = '';
  };

  async function send() {
    const text = input.value.trim();
    if (!text && !image) return;
    const btn = q('[data-t="send"]'); btn.disabled = true;
    const fd = new FormData();
    if (text) fd.append('text', text);
    if (image) fd.append('image', image, image.name || 'foto.jpg');
    t.messages.push({ id: 0, role: 'student', kind: 'answer', content: text || '📷 (imagem)', payload: null });
    const keep = { text, image };
    input.value = ''; input.style.height = 'auto'; setImage(null); paint(true);
    try {
      t = await api(`/tutor/${t.id}/message`, { body: fd });
    } catch (err) {
      t.messages.pop(); input.value = keep.text; setImage(keep.image); toast(err.message, { type: 'err' });
    }
    btn.disabled = false; paint(); input.focus();
  }

  q('[data-t="composer"]').onsubmit = (e) => { e.preventDefault(); send(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(140, input.scrollHeight)}px`; });
  input.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); setImage(f); }
  });
  q('[data-t="mic"]')?.addEventListener('click', () => listen('pt', (txt) => { input.value = (input.value + ' ' + txt).trim(); input.focus(); }));
  q('[data-t="close"]')?.addEventListener('click', () => onClose?.());
  q('[data-t="new"]').onclick = async () => {
    if (t.messages.length && !(await confirmDialog('Começar uma conversa nova no chat? A atual fica salva no histórico.', { okText: 'Nova conversa' }))) return;
    t = await api(`/languages/${lang.slug}/tutor/new`, { method: 'POST' }); paint();
  };
  if (!compact) input.focus();
  return { focus: () => input.focus() };
}
