// Foto/PDF de exercício: enviar → professor lê → revisar o conteúdo ou resolver junto
import { $app, esc, api, toast, langNav, go, confirmDialog } from '../core.js';
import { startActivity } from './dashboard.js';

export async function viewMaterials(lang) {
  const { materials } = await api(`/languages/${lang.slug}/materials`);
  $app.innerHTML = `
    ${langNav(lang, 'material')}
    <div class="stack">
      <div><h1>📷 Enviar exercício</h1><p class="muted">Tire uma foto da apostila, prova ou atividade (ou envie um PDF). O professor lê, explica o conteúdo e resolve com você — sem entregar as respostas.</p></div>
      <label class="card dropzone" id="drop">
        <input type="file" id="file" accept="image/*,application/pdf" capture="environment" hidden>
        <span style="font-size:2rem">📎</span><b>Escolher foto ou PDF</b><small class="muted">JPG, PNG, WEBP, HEIC ou PDF · até 10 MB</small>
      </label>
      ${materials.length ? `<section class="card"><h2>Materiais enviados</h2><ul class="list">${materials.map((m) => `
        <li class="spread"><a href="/${lang.slug}/material/${m.id}" data-link>${esc(m.titlePt || m.name || 'Material')}</a>
        <span class="muted small">${m.exercises.length} exercício(s) · ${new Date(m.createdAt).toLocaleDateString('pt-BR')}</span></li>`).join('')}</ul></section>` : ''}
    </div>`;
  const input = $app.querySelector('#file');
  const drop = $app.querySelector('#drop');
  const send = async (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast('Arquivo maior que 10 MB', { type: 'err' });
    drop.innerHTML = '<span style="font-size:2rem">⏳</span><b>O professor está lendo seu material…</b><small class="muted">Isso pode levar até 1 minuto</small>';
    const fd = new FormData(); fd.append('file', file);
    try { const m = await api(`/languages/${lang.slug}/materials`, { body: fd }); go(`/${lang.slug}/material/${m.id}`); }
    catch (err) { toast(err.message, { type: 'err' }); viewMaterials(lang); }
  };
  input.onchange = () => send(input.files[0]);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); send(e.dataTransfer.files[0]); });
}

export async function viewMaterial(lang, id) {
  const m = await api(`/languages/${lang.slug}/materials/${id}`);
  const render = (showReview) => {
    $app.innerHTML = `
      ${langNav(lang, 'material')}
      <div class="stack">
        <a href="/${lang.slug}/material" data-link class="small muted">← Materiais</a>
        <section class="card stack">
          <h1>${esc(m.titlePt || 'Material')}</h1>
          ${m.readable ? `<p>${esc(m.summaryPt)}</p>` : '<div class="hint">Não consegui ler bem esse material. Tente uma foto mais nítida e reta, com boa luz.</div>'}
          ${m.exercises.length ? `<div class="hint">👩‍🏫 Encontrei <b>${m.exercises.length}</b> exercício(s). Você quer resolver comigo ou primeiro revisar o conteúdo?</div>
            <div class="grid2" style="gap:10px"><button class="btn ghost" id="rev">📖 Revisar o conteúdo primeiro</button><button class="btn accent" id="solve">✍️ Resolver comigo</button></div>` : ''}
        </section>
        ${showReview ? `<section class="card stack"><h2>Revisão</h2><div class="prewrap">${esc(m.reviewPt)}</div>
          ${m.exercises.length ? '<button class="btn accent" id="solve2">Agora vamos resolver ✍️</button>' : ''}</section>` : ''}
        ${m.exercises.length ? `<section class="card"><h2>Exercícios encontrados</h2><ol class="exlist">${m.exercises.map((e) => `<li>
          ${e.instruction ? `<div class="muted small">${esc(e.instruction)}</div>` : ''}<div>${esc(e.question)}</div>
          ${e.options?.length ? `<div class="small muted">${e.options.map((o, i) => `${String.fromCharCode(97 + i)}) ${esc(o)}`).join(' · ')}</div>` : ''}</li>`).join('')}</ol></section>` : ''}
        <button class="btn ghost sm" id="del" style="align-self:flex-start">🗑️ Remover material</button>
      </div>`;
    const solve = (e) => startActivity(`/languages/${lang.slug}/materials/${m.id}/lesson`, {}, e.target, 'Preparando…');
    $app.querySelector('#rev')?.addEventListener('click', () => render(true));
    $app.querySelector('#solve')?.addEventListener('click', solve);
    $app.querySelector('#solve2')?.addEventListener('click', solve);
    $app.querySelector('#del').onclick = async () => {
      if (!(await confirmDialog('Remover este material?', { okText: 'Remover', danger: true }))) return;
      await api(`/languages/${lang.slug}/materials/${m.id}`, { method: 'DELETE' });
      go(`/${lang.slug}/material`);
    };
  };
  render(false);
}
