// "Escolha seu professor": cada voz do Gemini é um professor com personalidade, especialidade e avaliação
import { $app, esc, api, toast, state, speak, icon, play } from '../core.js';

const SPEC_PT = { conversacao: 'Conversação', trabalho: 'Trabalho', viagem: 'Viagem', escola: 'Escola', faculdade: 'Faculdade', prova: 'Provas', entrevista: 'Entrevistas', fluencia: 'Fluência' };
const FILTERS = [['all', 'Todos'], ['A1', 'Iniciantes'], ['conversacao', 'Conversação'], ['trabalho', 'Trabalho'], ['viagem', 'Viagem'], ['prova', 'Provas'], ['entrevista', 'Entrevistas']];

const intro = (t, lang) => (lang.code === 'es'
  ? `¡Hola! Soy ${t.name}. Me encantaría darte clases de español. ¿Practicamos juntos?`
  : `Hi! I'm ${t.name}. I'd love to be your English teacher. Shall we practice together?`);

export function stars(n) {
  return `<span class="stars" title="${n} de 5" aria-label="${n} de 5 estrelas">${[1, 2, 3, 4, 5].map((i) =>
    `<i class="st ${n >= i ? 'full' : n >= i - 0.5 ? 'half' : ''}">★</i>`).join('')}</span>`;
}

export function avatar(t, size = '') {
  return `<span class="avatar ${size}" style="--c:${t.color}">${esc(t.name.slice(0, 2))}</span>`;
}

function card(t, { current, recommended }) {
  return `<article class="glass teacher ${current ? 'current' : ''}" data-voice="${esc(t.voice)}">
    ${t.badge ? `<span class="ribbon">${esc(t.badge)}</span>` : ''}
    <div class="thead">${avatar(t)}<div><h3>${esc(t.name)}</h3>${stars(t.stars)}</div></div>
    <p class="tagline">${esc(t.tagline)}</p>
    <div class="chips small">${t.traits.map((x) => `<span class="chip static">${esc(x)}</span>`).join('')}</div>
    <div class="tmeta small muted">${t.specialties.slice(0, 3).map((s) => esc(SPEC_PT[s] || s)).join(' · ')}<br>${t.levels.join(', ')} · ${esc(t.pace)}</div>
    <div class="actions">
      <button class="btn ghost sm" data-hear="${esc(t.voice)}">${icon('speaker', 16)} Ouvir</button>
      ${current ? `<span class="tag">${icon('check', 14)} Seu professor</span>` : `<button class="btn sm ${recommended ? 'accent' : ''}" data-pick="${esc(t.voice)}">Escolher</button>`}
    </div>
  </article>`;
}

/** Destaque grande (topo da página), como no desenho */
function feature(t, current) {
  return `<article class="t-feature" data-voice="${esc(t.voice)}">
    ${t.badge ? `<span class="t-badge">${esc(t.badge)}</span>` : ''}
    <div class="t-feature-head"><div class="t-ring">${avatar(t, 'xl')}</div>
      <div><h2>${esc(t.name)}</h2>${stars(t.stars)}<div class="small muted">${esc(t.pace)} · ${t.levels.join(' a ')}</div></div></div>
    <p class="t-quote">“${esc(t.tagline)}”</p>
    <div class="chips">${t.traits.map((x) => `<span class="chip static">${esc(x)}</span>`).join('')}</div>
    <div class="t-actions"><button class="btn ghost" data-hear="${esc(t.voice)}">${icon('speaker', 18)} Ouvir</button>
      ${current ? `<span class="btn violet">${icon('check', 18)} Seu professor</span>` : `<button class="btn accent glow" data-pick="${esc(t.voice)}">Escolher ${esc(t.name)}</button>`}</div>
  </article>`;
}

function row(t, current) {
  return `<div class="glass t-row ${current ? 'current' : ''}">${avatar(t, 'md')}
    <div style="flex:1;min-width:0"><div><b>${esc(t.name)}</b> ${stars(t.stars)}</div><div class="small ${current ? 'violet-text' : 'muted'}">${current ? 'Seu professor atual' : esc(t.traits.slice(0, 2).join(' · '))}</div></div>
    <button class="icon-btn" data-hear="${esc(t.voice)}" aria-label="Ouvir ${esc(t.name)}">${play()}</button>
    ${current ? `<span class="icon-btn solid-violet">${icon('check', 18)}</span>` : `<button class="btn sm" data-pick="${esc(t.voice)}">Escolher</button>`}
  </div>`;
}

function bind(root, lang, onPick) {
  root.querySelectorAll('[data-hear]').forEach((b) => {
    const t = state.meta.teachers.find((x) => x.voice === b.dataset.hear);
    b.onclick = () => speak(intro(t, lang), lang.slug, { button: b, voice: t.voice });
  });
  root.querySelectorAll('[data-pick]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        await api(`/languages/${lang.slug}/profile`, { method: 'PATCH', body: { teacherVoice: b.dataset.pick } });
        toast(`${b.dataset.pick} agora é seu professor de ${lang.namePt}!`, { type: 'ok' });
        onPick(b.dataset.pick);
      } catch (e) { toast(e.message, { type: 'err' }); b.disabled = false; }
    };
  });
}

export async function viewTeachers(lang) {
  const d = await api(`/languages/${lang.slug}/dashboard`);
  let current = d.teacher.voice;
  let filter = 'all';
  const all = state.meta.teachers;
  const rec = d.recommendedTeachers;

  const render = () => {
    const list = all.filter((t) => filter === 'all' || (filter === 'A1' ? t.levels.includes('A1') : t.specialties.includes(filter)));
    const groups = [
      ['Destaques', list.filter((t) => t.stars >= 5)],
      ['Muito bem avaliados', list.filter((t) => t.stars >= 4 && t.stars < 5)],
      ['Estilos específicos', list.filter((t) => t.stars < 4)],
    ].filter(([, g]) => g.length);
    const cur = all.find((t) => t.voice === current);
    const top = all.find((t) => t.voice === rec[0]) || cur;
    $app.innerHTML = `
      <div class="stack">
        <header class="t-head"><span class="eyebrow violet">${all.length} PROFESSORES</span><h1 class="mega-sm">Escolha seu<br>professor</h1>
          <p class="muted">Cada um tem voz e jeito próprio de ensinar, e a personalidade muda o jeito de dar aula. Ouça antes de escolher.</p></header>
        <div class="chips">${FILTERS.map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
        <div class="t-top">
          ${feature(top, top.voice === current)}
          <section class="stack"><h2>Para você</h2><p class="muted small" style="margin-top:-8px">Com base no seu nível (${esc(d.level)}) e objetivo (${esc(state.meta.goals[d.profile.goal])}).</p>
            <div class="t-rows">${[cur, ...rec.filter((v) => v !== current && v !== top.voice).map((v) => all.find((t) => t.voice === v))].filter(Boolean).slice(0, 5).map((t) => row(t, t.voice === current)).join('')}</div></section>
        </div>
        ${groups.map(([title, g]) => `<section class="stack"><h2>${title}</h2><div class="teachers">${g.map((t) => card(t, { current: t.voice === current })).join('')}</div></section>`).join('')}
      </div>`;
    $app.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { filter = b.dataset.f; render(); }; });
    bind($app, lang, (v) => { current = v; render(); });
  };
  render();
}

/** Faixa compacta para as telas de conversa/aula ao vivo: professor atual + recomendados */
export function teacherStrip(lang, d) {
  const all = state.meta.teachers;
  const cur = all.find((t) => t.voice === d.teacher.voice);
  const others = d.recommendedTeachers.filter((v) => v !== cur.voice).slice(0, 3).map((v) => all.find((t) => t.voice === v));
  return `<section class="glass card-pad stack teacher-strip">
    <div class="spread wrap"><div class="small muted">SEU PROFESSOR</div><a href="/${lang.slug}/professores" data-link class="small">Ver todos os 30 professores →</a></div>
    <div class="current-teacher">${avatar(cur, 'lg')}<div style="flex:1"><div class="big">${esc(cur.name)} ${stars(cur.stars)}</div>
      <div class="muted small">${esc(cur.tagline)}</div></div><button class="icon-btn" data-hear="${esc(cur.voice)}" aria-label="Ouvir">${play()}</button></div>
    ${others.length ? `<div class="small muted">Ou experimente:</div><div class="mini-teachers">${others.map((t) => `
      <div class="mini">${avatar(t)}<div><b>${esc(t.name)}</b>${stars(t.stars)}<div class="small muted">${esc(t.traits.slice(0, 2).join(' · '))}</div></div>
        <div class="mini-actions"><button class="icon-btn" data-hear="${esc(t.voice)}" aria-label="Ouvir">${play()}</button><button class="btn sm" data-pick="${esc(t.voice)}">Escolher</button></div></div>`).join('')}</div>` : ''}
  </section>`;
}

export function bindTeacherStrip(root, lang, onPick) { bind(root, lang, onPick); }
