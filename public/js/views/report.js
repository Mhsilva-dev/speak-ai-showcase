// Relatório semanal + conquistas
import { $app, esc, api, langNav, AREA_LABEL, state, toast } from '../core.js';

export async function viewReport(lang) {
  const [r, d] = await Promise.all([api(`/languages/${lang.slug}/report`), api(`/languages/${lang.slug}/dashboard`)]);
  const h = Math.floor(r.minutes / 60);
  const time = h ? `${h}h${String(r.minutes % 60).padStart(2, '0')}` : `${r.minutes} min`;
  const delta = (v) => (v > 0 ? `<span class="up">+${v}%</span>` : v < 0 ? `<span class="down">${v}%</span>` : '<span class="muted">—</span>');
  $app.innerHTML = `
    ${langNav(lang, 'relatorio')}
    <div class="stack">
      <div class="spread wrap-gap"><div><h1>📈 Sua semana</h1><p class="muted small">Últimos 7 dias em ${esc(lang.namePt)}</p></div>
        <label class="mailpref"><input type="checkbox" id="weeklyEmail" ${state.me.weeklyEmail ? 'checked' : ''}> Receber por e-mail toda segunda</label></div>
      <section class="kpis">
        <div class="card kpi"><b>${time}</b><span>tempo estudado</span></div>
        <div class="card kpi"><b>${r.activeDays}/7</b><span>dias ativos</span></div>
        <div class="card kpi"><b>${r.lessons}</b><span>aulas</span></div>
        <div class="card kpi"><b>${r.conversations + r.roleplays}</b><span>conversas e roleplays</span></div>
        <div class="card kpi"><b>${r.words.added + r.words.reviewed}</b><span>palavras praticadas</span></div>
        <div class="card kpi"><b>${r.errorsCorrected}</b><span>erros corrigidos</span></div>
        <div class="card kpi"><b>${r.xp}</b><span>XP</span></div>
        <div class="card kpi"><b>${r.pronunciation ? `${r.pronunciation.avg}%` : '—'}</b><span>pronúncia média</span></div>
      </section>
      <div class="grid2">
        <section class="card"><h2>Evolução das habilidades</h2>
          <ul class="list">${r.areas.map((a) => `<li class="spread"><span>${AREA_LABEL[a.area]}</span><span>${a.now}% ${delta(a.delta)}</span></li>`).join('')}</ul></section>
        <section class="card"><h2>Principais dificuldades</h2>
          ${r.difficulties.length ? `<ul class="list">${r.difficulties.map((e) => `<li><span class="strike">${esc(e.actual)}</span> → <b>${esc(e.expected)}</b> <span class="muted small">· ${e.frequency}x</span></li>`).join('')}</ul>`
            : '<p class="muted small">Nenhum erro recorrente nesta semana. 👏</p>'}</section>
      </div>
      <section class="card focus"><h2>Próxima semana</h2>
        <p>Foco em: <b>${r.nextWeek.skills.map(esc).join(', ') || '—'}</b>${r.nextWeek.area ? ` e mais prática de <b>${esc(AREA_LABEL[r.nextWeek.area])}</b>` : ''}.</p>
        <p class="muted small">A "Minha aula de hoje" já prioriza esses pontos automaticamente.</p></section>
      <section class="card"><h2>Conquistas</h2>
        <div class="badges">${d.achievements.map((a) => `<div class="badge ${a.unlockedAt ? '' : 'locked'}" title="${esc(a.desc)}"><span>${a.unlockedAt ? a.icon : '🔒'}</span>${esc(a.name)}
          <small>${a.unlockedAt ? new Date(a.unlockedAt).toLocaleDateString('pt-BR') : esc(a.desc)}</small></div>`).join('')}</div></section>
    </div>`;
  $app.querySelector('#weeklyEmail').onchange = async (ev) => {
    const on = ev.target.checked;
    try {
      await api('/auth/prefs', { method: 'PATCH', body: { weeklyEmail: on } });
      state.me.weeklyEmail = on;
      toast(on ? 'Você vai receber o relatório toda segunda' : 'Relatório por e-mail desligado', { type: 'ok' });
    } catch (err) { ev.target.checked = !on; toast(err.message, { type: 'err' }); }
  };
}
