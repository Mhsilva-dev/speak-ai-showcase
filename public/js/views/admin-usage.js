// Admin → Uso da API: custo estimado, minutos de voz, erros de cota e consumo por usuário e por modelo
import { esc, api, toast } from '../core.js';

// Cores por tipo de uso (validadas para daltonismo no fundo escuro do app); a ordem é fixa
const SERIES = [
  { key: 'live', label: 'Voz ao vivo', long: 'Voz ao vivo', color: '#3987e5' },
  { key: 'text', label: 'Texto', long: 'Texto (aulas, chat, correções)', color: '#d95926' },
  { key: 'audio', label: 'Áudio', long: 'Áudio (fala e pronúncia)', color: '#199e70' },
];
const KIND = { live: 'Voz ao vivo', text: 'Texto', audio: 'Áudio' };

let rate = 5.5;
const brl = (usd, digits = 2) => (usd * rate).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: digits, maximumFractionDigits: digits });
const usdFmt = (usd) => `US$ ${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: usd < 1 ? 4 : 2 })}`;
const mins = (sec) => (sec >= 3600 ? `${Math.floor(sec / 3600)}h${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}` : `${Math.round(sec / 60)} min`);
const dayLabel = (d) => { const [, m, dd] = d.split('-'); return `${dd}/${m}`; };
const weekday = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
const nfmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const ago = (d) => {
  if (!d) return '—';
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 3600) return `há ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return new Date(d).toLocaleDateString('pt-BR');
};

/** "Teto" agradável para o eixo: 1, 2, 2.5, 5 × 10^n */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

/**
 * Barras (empilhadas quando há mais de uma série). Uma coluna por dia, tooltip por coluna.
 * rows: [{ day, ...valores }]; series: [{ key, label, color }]; fmt: formata o valor do eixo/tooltip
 */
function barChart(el, rows, series, { fmt, tipExtra = () => '' }) {
  const W = Math.max(el.clientWidth, 300);
  const H = 220;
  const m = { t: 12, r: 18, b: 26, l: 56 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const totals = rows.map((r) => series.reduce((s, x) => s + r[x.key], 0));
  const max = niceMax(Math.max(...totals) * 1.05);
  const y = (v) => m.t + ih - (v / max) * ih;
  const step = iw / rows.length;
  const bw = Math.max(2, Math.min(28, step * 0.62));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.ceil(rows.length / Math.floor(iw / 46));

  let bars = '';
  rows.forEach((r, i) => {
    const x = m.l + i * step + (step - bw) / 2;
    let acc = 0;
    const segs = series.map((s) => ({ s, v: r[s.key] })).filter((p) => p.v > 0);
    segs.forEach((p, j) => {
      const y0 = y(acc); const y1 = y(acc + p.v); acc += p.v;
      const top = j === segs.length - 1;
      const h = Math.max(1, y0 - y1 - (top ? 0 : 2)); // 2px de respiro entre segmentos
      const yy = y0 - h;
      const rad = top ? Math.min(4, bw / 2, h) : 0;
      bars += rad
        ? `<path d="M${x},${y0} V${yy + rad} Q${x},${yy} ${x + rad},${yy} H${x + bw - rad} Q${x + bw},${yy} ${x + bw},${yy + rad} V${y0} Z" fill="${p.s.color}"/>`
        : `<rect x="${x}" y="${yy}" width="${bw}" height="${h}" fill="${p.s.color}"/>`;
    });
  });

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Gráfico de barras por dia">
    ${ticks.map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="grid${t === 0 ? ' base' : ''}"/>
      <text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end" class="tick">${fmt(t, true)}</text>`).join('')}
    ${rows.map((r, i) => (i % labelEvery === 0 || (i === rows.length - 1 && i % labelEvery >= labelEvery / 2) ? `<text x="${m.l + i * step + step / 2}" y="${H - 8}" text-anchor="middle" class="tick">${dayLabel(r.day)}</text>` : '')).join('')}
    <g>${bars}</g>
    <line class="hover-line" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>
    ${rows.map((r, i) => `<rect class="hit" data-i="${i}" x="${m.l + i * step}" y="${m.t}" width="${step}" height="${ih}" fill="transparent"/>`).join('')}
  </svg><div class="viz-tip" hidden></div>`;

  const tip = el.querySelector('.viz-tip');
  const line = el.querySelector('.hover-line');
  el.querySelectorAll('.hit').forEach((h) => {
    h.onmouseenter = h.onfocus = () => {
      const i = Number(h.dataset.i); const r = rows[i];
      const cx = m.l + i * step + step / 2;
      line.setAttribute('x1', cx); line.setAttribute('x2', cx); line.setAttribute('visibility', 'visible');
      tip.innerHTML = `<b>${weekday(r.day)}, ${dayLabel(r.day)}</b>
        ${series.map((s) => `<div class="tip-row"><i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${fmt(r[s.key])}</b></div>`).join('')}
        ${series.length > 1 ? `<div class="tip-row total"><span>Total</span><b>${fmt(totals[i])}</b></div>` : ''}${tipExtra(r)}`;
      tip.hidden = false;
      const left = (cx / W) * el.clientWidth;
      tip.style.left = `${Math.min(Math.max(left, 90), el.clientWidth - 90)}px`;
    };
  });
  el.querySelector('svg').onmouseleave = () => { tip.hidden = true; line.setAttribute('visibility', 'hidden'); };
}

export async function viewUsage(root, { openUser }) {
  let days = 30;
  let data = null;
  let sort = { key: 'costMonth', dir: -1 };
  let asTable = false;

  root.innerHTML = `
    <div class="usage-top">
      <p class="small muted" id="u-note"></p>
      <div class="chips" id="u-days">${[7, 30, 90].map((d) => `<button class="chip ${d === days ? 'on' : ''}" data-d="${d}">${d} dias</button>`).join('')}</div>
    </div>
    <section class="kpis-a" id="u-kpis"></section>
    <div class="usage-grid">
      <section class="glass card-pad viz">
        <div class="spread"><div><h2>Custo estimado por dia</h2><p class="small muted">Em reais, separado pelo tipo de uso</p></div>
          <button class="btn ghost sm" id="u-astable">Ver tabela</button></div>
        <div class="legend">${SERIES.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.long)}</span>`).join('')}</div>
        <div class="chart" id="u-cost"></div>
      </section>
      <section class="glass card-pad viz">
        <div><h2>Minutos de voz por dia</h2><p class="small muted">Soma de todos os alunos</p></div>
        <div class="chart" id="u-voice"></div>
      </section>
    </div>
    <section class="glass card-pad">
      <div class="spread"><div><h2>Consumo por usuário</h2><p class="small muted">Clique para ver detalhes e mudar o limite de voz</p></div></div>
      <div class="ttable-wrap"><table class="ttable" id="u-users"></table></div>
    </section>
    <div class="usage-grid">
      <section class="glass card-pad"><h2>Por modelo</h2><div class="ttable-wrap"><table class="ttable" id="u-models"></table></div></section>
      <section class="glass card-pad"><h2>Saúde da API</h2><div id="u-health"></div></section>
    </div>`;

  const paint = () => {
    const t = data.totals;
    rate = data.config.usdBrl;
    root.querySelector('#u-note').innerHTML = `Valores <b>estimados</b> pelo preço do plano pago do Gemini (US$ 1 = R$ ${rate.toFixed(2).replace('.', ',')}). Enquanto a chave estiver no plano grátis, o custo real é zero.
      Limite padrão de voz: <b>${data.config.voiceDailyMinutes} min por aluno por dia</b>.${t.since ? ` Medindo desde ${new Date(t.since).toLocaleDateString('pt-BR')}.` : ''}`;

    const k = (v, l, sub = '', cls = '') => `<div class="glass kpi-a ${cls}"><b>${v}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    root.querySelector('#u-kpis').innerHTML =
      k(brl(t.costToday), 'Custo hoje', usdFmt(t.costToday))
      + k(brl(t.costMonth), 'Custo no mês', usdFmt(t.costMonth))
      + k(brl(t.projectedMonth), 'Projeção do mês', 'média dos últimos 7 dias × 30')
      + k(mins(t.voiceToday), 'Voz hoje', `${mins(t.voiceMonth)} no mês`)
      + k(t.callsToday, 'Chamadas à IA hoje')
      + k(`${t.errorsToday ? '⚠️ ' : '✓ '}${t.errorsToday}`, 'Erros hoje', t.errorsHour ? `${t.errorsHour} na última hora` : 'nenhum na última hora', t.errorsHour ? 'warn' : 'on');

    const costRows = data.perDay.map((d) => ({ ...d, live: d.live * rate, text: d.text * rate, audio: d.audio * rate }));
    const money = (v, axis) => (axis ? `R$ ${Number.isInteger(v) ? v : v.toFixed(v < 1 ? 2 : 1).replace('.', ',')}` : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
    const costEl = root.querySelector('#u-cost');
    if (asTable) {
      costEl.innerHTML = `<div class="ttable-wrap"><table class="ttable"><thead><tr><th>Dia</th>${SERIES.map((s) => `<th class="num">${esc(KIND[s.key])}</th>`).join('')}<th class="num">Total</th><th class="num">Chamadas</th><th class="num">Erros</th></tr></thead>
        <tbody>${[...costRows].reverse().map((r) => `<tr><td>${weekday(r.day)} ${dayLabel(r.day)}</td>${SERIES.map((s) => `<td class="num">${money(r[s.key])}</td>`).join('')}
          <td class="num"><b>${money(r.live + r.text + r.audio)}</b></td><td class="num">${r.calls}</td><td class="num">${r.errors}</td></tr>`).join('')}</tbody></table></div>`;
    } else {
      barChart(costEl, costRows, SERIES, { fmt: money, tipExtra: (r) => `<div class="tip-row muted"><span>${r.calls} chamadas · ${r.users} aluno(s)${r.errors ? ` · ${r.errors} erro(s)` : ''}</span></div>` });
    }
    root.querySelector('#u-astable').textContent = asTable ? 'Ver gráfico' : 'Ver tabela';
    barChart(root.querySelector('#u-voice'), data.perDay, [{ key: 'voiceMin', label: 'Minutos de voz', color: '#3987e5' }],
      { fmt: (v, axis) => (axis ? `${Number.isInteger(v) ? v : v.toFixed(1).replace('.', ',')} min` : `${v.toLocaleString('pt-BR')} min`) });

    // Usuários
    const users = [...data.perUser].sort((a, b) => {
      const av = a[sort.key] ?? ''; const bv = b[sort.key] ?? '';
      return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * sort.dir;
    });
    const th = (key, label, cls = '') => `<th class="${cls} sortable ${sort.key === key ? 'on' : ''}" data-s="${key}" aria-sort="${sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">${label}${sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    root.querySelector('#u-users').innerHTML = `<thead><tr>${th('name', 'Usuário')}${th('voiceToday', 'Voz hoje')}${th('voiceMonth', 'Voz no mês', 'num')}${th('costToday', 'Hoje', 'num')}${th('costMonth', 'No mês', 'num')}${th('costTotal', 'Total', 'num')}${th('lastUse', 'Último uso', 'hide-sm')}</tr></thead>
      <tbody>${users.map((u) => {
        const pct = u.limit ? Math.min(100, (u.voiceToday / (u.limit * 60)) * 100) : 0;
        const full = u.limit != null && u.voiceToday >= u.limit * 60 - 30;
        return `<tr data-u="${u.id}" tabindex="0">
          <td><b>${esc(u.name)}</b>${u.isAdmin ? ' <em class="badge-a">admin</em>' : ''}<small class="muted block">${esc(u.email)}</small></td>
          <td class="vcell"><span>${mins(u.voiceToday)} / ${u.limit == null ? '∞' : `${u.limit} min`}${u.customLimit != null ? ' <em class="badge-a">próprio</em>' : ''}</span>
            ${u.limit ? `<span class="vbar${full ? ' full' : ''}" title="${Math.round(pct)}% do limite"><i style="width:${pct}%"></i></span>` : ''}</td>
          <td class="num">${mins(u.voiceMonth)}</td>
          <td class="num">${brl(u.costToday)}</td><td class="num"><b>${brl(u.costMonth)}</b></td><td class="num">${brl(u.costTotal)}</td>
          <td class="hide-sm small muted">${ago(u.lastUse)}</td></tr>`;
      }).join('')}</tbody>`;
    root.querySelectorAll('#u-users [data-s]').forEach((h) => {
      h.onclick = () => { sort = { key: h.dataset.s, dir: sort.key === h.dataset.s ? -sort.dir : (h.dataset.s === 'name' ? 1 : -1) }; paint(); };
    });
    root.querySelectorAll('#u-users [data-u]').forEach((r) => {
      r.onclick = () => openUser(Number(r.dataset.u));
      r.onkeydown = (e) => { if (e.key === 'Enter') openUser(Number(r.dataset.u)); };
    });

    // Modelos
    root.querySelector('#u-models').innerHTML = data.perModel.length ? `<thead><tr><th>Modelo</th><th>Tipo</th><th class="num">Chamadas</th><th class="num">Tokens</th><th class="num">Custo</th></tr></thead>
      <tbody>${data.perModel.map((m) => `<tr><td><code>${esc(m.model)}</code></td><td>${esc(KIND[m.kind] || m.kind)}</td>
        <td class="num">${m.calls}${m.errors ? ` <small class="warn-t">+${m.errors} erro(s)</small>` : ''}</td>
        <td class="num">${nfmt(m.input)} → ${nfmt(m.output)}</td><td class="num">${brl(m.cost)}</td></tr>`).join('')}</tbody>`
      : '<tbody><tr><td class="muted">Sem uso no período.</td></tr></tbody>';

    // Saúde
    const errs = data.recentErrors;
    root.querySelector('#u-health').innerHTML = `
      <p class="health ${t.errorsHour ? 'warn' : 'ok'}">${t.errorsHour ? `⚠️ <b>${t.errorsHour} erro(s) na última hora.</b> Se for "quota", a cota grátis acabou: o app tenta outros modelos sozinho.` : '✓ <b>Funcionando normalmente.</b> Nenhum erro na última hora.'}</p>
      ${errs.length ? `<h3>Últimos erros</h3><ul class="list err-list">${errs.map((e) => `<li><span class="small"><b>${esc(e.model)}</b> · ${esc(e.task)}${e.name ? ` · ${esc(e.name)}` : ''}<br><span class="muted">${esc(/quota/i.test(e.error || '') ? 'Cota esgotada (429)' : (e.error || '').slice(0, 120))}</span></span><span class="small muted">${ago(e.created_at)}</span></li>`).join('')}</ul>` : ''}`;
  };

  async function load() {
    try { data = await api(`/admin/usage?days=${days}`); paint(); } catch (e) { toast(e.message, { type: 'err' }); }
  }
  root.querySelectorAll('[data-d]').forEach((b) => {
    b.onclick = () => { days = Number(b.dataset.d); root.querySelectorAll('[data-d]').forEach((x) => x.classList.toggle('on', x === b)); load(); };
  });
  root.querySelector('#u-astable').onclick = () => { asTable = !asTable; paint(); };
  let resizeT;
  const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (data && root.isConnected) paint(); }, 150); };
  window.addEventListener('resize', onResize);
  await load();
  return { reload: load };
}
