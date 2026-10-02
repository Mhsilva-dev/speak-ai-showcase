// Painel do idioma: nível, metas, aula do dia, foco, atalhos, habilidades, erros e conquistas
import { $app, esc, api, go, toast, state, bar, icon, ring, greeting, AREA_LABEL, MODE_LABEL } from '../core.js';
import { viewOnboarding } from './start.js';
import { avatar, stars } from './teachers.js';
import { reminderWidget } from '../push.js';

export async function startActivity(path, body, btn, label) {
  if (btn) { btn.disabled = true; btn.dataset.l = btn.textContent; btn.textContent = label || 'O professor está preparando…'; }
  try {
    const s = await api(path, { body });
    go(`/${s.language}/aula/${s.id}`);
  } catch (e) {
    toast(e.message, { type: 'err' });
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.l; }
  }
}

export async function viewDashboard(lang) {
  const d = await api(`/languages/${lang.slug}/dashboard`);
  if (!d.enrolled) return viewOnboarding(lang);
  const f = d.todayFocus;
  const unlocked = d.achievements.filter((a) => a.unlockedAt).sort((a, b) => new Date(b.unlockedAt) - new Date(a.unlockedAt));
  const nextAch = d.achievements.filter((a) => !a.unlockedAt).slice(0, 3);
  const active = d.activeLessonId;

  const first = esc(state.me.name.split(' ')[0]);
  const review = d.dailyReview;
  const otherReview = review.filter((r) => !['live', 'conversation'].includes(r.source));
  const tile = (href, ic, cls, title, sub) => `<a href="/${lang.slug}/${href}" data-link class="glass tile"><span class="tile-ico ${cls}">${icon(ic)}</span><div><b>${title}</b><small>${sub}</small></div></a>`;
  const BADGE = ['b-orange', 'b-violet', 'b-blue'];

  $app.innerHTML = `
    <header class="dash-head">
      <div><div class="muted">${greeting()},</div><h1>${first}, bora falar ${esc(lang.namePt.toLowerCase())}?</h1></div>
      <a href="/${lang.slug}/professores" data-link class="dash-teacher">${avatar(d.teacher, 'sm')}<span>${esc(d.teacher.name)} ${stars(d.teacher.stars)}</span><small>${d.teacherChosen ? 'trocar' : 'escolher'}</small></a>
    </header>

    <div class="bento">
      <section class="lvl-card">
        ${ring(d.progress, 124, esc(d.level), `${d.progress}% do nível`)}
        <div class="lvl-side">
          <div class="streak"><span class="flame">${icon('flame', 18)}</span><div><b>${d.streak} dia${d.streak === 1 ? '' : 's'}</b><small>de sequência</small></div></div>
          <div><div class="spread small"><span class="muted">Meta de hoje</span><b>${d.goals.daily.value}/${d.goals.daily.goal} XP</b></div>${bar(d.goals.daily.pct)}</div>
          <div><div class="spread small"><span class="muted">Semana</span><b>${d.goals.weekly.value}/${d.goals.weekly.goal} aulas</b></div>${bar(d.goals.weekly.pct)}</div>
          <div id="remind"></div>
        </div>
      </section>

      ${active ? `<section class="today">
        <span class="eyebrow">ATIVIDADE EM ANDAMENTO</span>
        <h2>${esc(MODE_LABEL[d.activeLessonMode] || 'Aula')}</h2>
        <a class="btn dark" href="/${lang.slug}/aula/${active}" data-link>Continuar ${icon('arrow', 16)}</a>
      </section>` : `<section class="today">
        <span class="eyebrow">MINHA AULA DE HOJE${d.goals.dailyLessonDone ? ' · CONCLUÍDA' : ''}</span>
        <h2>${d.goals.dailyLessonDone ? 'Quer praticar mais?' : 'Revisão do que você disse'}</h2>
        <ul class="today-list">
          ${review.filter((r) => r.source === 'live' || r.source === 'conversation').slice(0, 3).map((r) => `<li>${icon(r.source === 'live' ? 'mic' : 'chat', 16)}<span><s>${esc(r.actual)}</s> → <b>${esc(r.expected)}</b></span></li>`).join('')}
          ${otherReview.length ? `<li>${icon('pen', 16)}<span>Revisar: ${otherReview.slice(0, 2).map((r) => `<s>${esc(r.actual)}</s> → <b>${esc(r.expected)}</b>`).join(' · ')}</span></li>` : ''}
          ${d.vocabulary.due ? `<li>${icon('cards', 16)}<span>${d.vocabulary.due} palavra(s) para revisar</span></li>` : ''}
          ${f ? `<li>${icon('book', 16)}<span>Praticar <b>${esc(f.skill.name)}</b> (${f.skill.score}%)</span></li>` : ''}
        </ul>
        <button class="btn dark" id="daily">${d.goals.dailyLessonDone ? 'Fazer outra aula' : 'Começar aula'} ${icon('arrow', 16)}</button>
      </section>`}

      <a href="/${lang.slug}/ao-vivo" data-link class="glass voice-card">
        <div class="orb-wrap"><i class="sphere xl"></i></div>
        <div><b class="h3">Conversar por voz</b><div class="muted small">Ao vivo com ${esc(d.teacher.name)} · fala, ele responde</div></div>
        <span class="play-dot">${icon('arrow', 18)}</span>
      </a>

      <section class="tiles">
        ${tile('chat', 'chat', 'violet', 'Chat livre', 'Dúvidas, frases, fotos')}
        ${tile('vocabulario', 'cards', 'orange', 'Flashcards', d.vocabulary.due ? `${d.vocabulary.due} para revisar` : `${d.vocabulary.total} palavras`)}
        ${tile('pronuncia', 'wave', 'amber', 'Pronúncia', f?.pronunciation ? `${esc(f.pronunciation.title)} ${esc(f.pronunciation.ipa)}` : 'Shadowing e ditado')}
        ${tile('material', 'camera', 'blue', 'Foto do exercício', 'Livro, prova, apostila')}
      </section>

      <section class="glass card-pad">
        <div class="spread"><h2>Habilidades</h2><span class="small muted">${d.xp} XP</span></div>
        ${d.areas.map((a) => `<div class="skill"><div class="spread small"><span>${AREA_LABEL[a.area]}</span><span class="muted">${a.score}%</span></div>${bar(a.score)}</div>`).join('')}
      </section>
    </div>

    <section class="tiles tiles-4">
      ${tile('conversa', 'guide', 'violet', 'Conversa guiada', 'Por texto, com correção')}
      ${tile('roleplay', 'mask', 'pink', 'Roleplay', 'Hotel, aeroporto, entrevista')}
      ${tile('professores', 'user', 'orange', 'Professores', '30 vozes diferentes')}
      ${tile('relatorio', 'chart', 'blue', 'Relatório', 'Sua semana')}
    </section>

    ${f ? `<section class="glass card-pad stack">
      <span class="eyebrow violet">FOCO DE HOJE</span>
      <div class="focusgrid">
        <div><span class="tag">Gramática</span><div class="big">${esc(f.skill.name)}</div></div>
        ${f.pronunciation ? `<div><span class="tag">Pronúncia</span><div class="big"><a href="/${lang.slug}/pronuncia#${f.pronunciation.code}" data-link>${esc(f.pronunciation.title)} ${esc(f.pronunciation.ipa)}</a></div></div>` : ''}
        <div><span class="tag">Tema</span><div class="big">${esc(f.topic)}</div></div>
      </div>
      ${active ? '' : `<div class="row-form"><select id="topic" aria-label="Tema da aula"><option value="">Tema sugerido: ${esc(f.topic)}</option><option value="surprise">Surpreenda-me</option>
        ${state.meta.topics.map((t) => `<option>${esc(t)}</option>`).join('')}</select>
        <button class="btn" id="start">Aula de ${esc(f.skill.name)}</button></div>`}
    </section>` : ''}

    <div class="grid2">
      <section class="glass card-pad"><h2>Erros recorrentes</h2>
        ${d.recurringErrors.length ? `<ul class="list">${d.recurringErrors.map((e) => `<li><span class="strike">${esc(e.actual)}</span> → <b>${esc(e.expected)}</b>
          <span class="muted small">· ${e.frequency}x</span></li>`).join('')}</ul>` : '<p class="muted small">Nenhum ainda. Eles aparecem aqui conforme você pratica.</p>'}
      </section>
      <section class="glass card-pad"><div class="spread"><h2>Conquistas</h2><span class="muted small">${unlocked.length}/${d.achievements.length}</span></div>
        <div class="gems">${unlocked.slice(0, 6).map((a, i) => `<div class="gem" title="${esc(a.desc)}"><span class="${BADGE[i % 3]}">${icon('check', 20)}</span>${esc(a.name)}</div>`).join('')}
          ${nextAch.map((a) => `<div class="gem locked" title="${esc(a.desc)}"><span>${icon('lock', 18)}</span>${esc(a.name)}</div>`).join('')}</div>
      </section>
    </div>

    <div class="grid2">
      <section class="glass card-pad"><h2>Gramática do nível</h2>
        <ul class="list">${d.skills.filter((s) => s.level === d.level).map((s) => `<li class="spread"><span>${esc(s.name)}</span><span class="muted small">${s.score}% · ${esc(s.band)}</span></li>`).join('')}</ul>
      </section>
      <section class="glass card-pad"><h2>Últimas atividades</h2>
        ${d.recentLessons.length ? `<ul class="list">${d.recentLessons.map((l) => `<li><a href="/${lang.slug}/aula/${l.id}" data-link>${esc(MODE_LABEL[l.mode] || 'Aula')}: ${esc(l.skill && ['lesson', 'daily', 'words'].includes(l.mode) ? l.skill : l.topic)}</a>
          <span class="muted small">${l.accuracy != null ? `· ${l.accuracy}%` : ''}</span></li>`).join('')}</ul>` : '<p class="muted small">Sua primeira aula vai aparecer aqui.</p>'}
      </section>
    </div>
    <p class="small muted center">${d.placement ? `Nivelamento: ${esc(d.placement.level)} · ${d.placement.confidence}% de confiança · ` : ''}Professor <b>${esc({ friendly: 'amigável', balanced: 'equilibrado', strict: 'rígido' }[d.profile.teachingStyle])}</b> ·
      objetivo: <b>${esc(state.meta.goals[d.profile.goal])}</b> · <a href="#" id="edit">ajustar perfil e metas</a></p>`;

  reminderWidget($app.querySelector('#remind'));
  $app.querySelector('#edit').onclick = (e) => { e.preventDefault(); viewOnboarding(lang, d.profile); };
  $app.querySelector('#daily')?.addEventListener('click', (e) => startActivity(`/languages/${lang.slug}/lessons`, { mode: 'daily' }, e.target, 'Montando sua aula de hoje…'));
  $app.querySelector('#start')?.addEventListener('click', (e) => startActivity(`/languages/${lang.slug}/lessons`, { mode: 'lesson', topic: $app.querySelector('#topic').value || undefined }, e.target));
}
