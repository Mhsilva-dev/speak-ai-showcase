// Painel de administração: quem se cadastrou, quem está online e gestão das contas
import { $app, esc, api, go, toast, state, icon, confirmDialog, promptDialog } from '../core.js';
import { viewUsage } from './admin-usage.js';

const STATUS = { live: 'Em aula por voz', online: 'Online', offline: 'Offline' };
const MODE = { lesson: 'Aula', daily: 'Aula do dia', words: 'Palavras', material: 'Material', conversation: 'Conversa', roleplay: 'Roleplay', live: 'Voz ao vivo' };

function ago(d) {
  if (!d) return 'nunca';
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 30 * 86400) return `há ${Math.floor(s / 86400)} dia(s)`;
  return new Date(d).toLocaleDateString('pt-BR');
}
const date = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const dot = (st) => `<span class="st-dot ${st}" aria-hidden="true"></span>`;

export async function viewAdmin() {
  if (!state.me?.isAdmin) return go('/');
  let data = null;
  let q = '';
  let filter = 'all';
  let openId = null;
  let timer = null;

  $app.className = 'container admin';
  $app.innerHTML = `
    <header class="admin-head">
      <div><span class="eyebrow violet">ADMINISTRAÇÃO</span><h1>Painel do sistema</h1></div>
      <span class="small muted" id="upd"></span>
    </header>
    <div class="tabs admin-tabs" role="tablist"><button data-tab="users" class="on" role="tab">Usuários</button><button data-tab="usage" role="tab">Uso da API e custos</button></div>
    <div id="tab-users">
    <section class="kpis-a" id="kpis"></section>
    <section class="glass card-pad">
      <div class="admin-tools">
        <input id="q" type="search" placeholder="Buscar por nome ou e-mail…" aria-label="Buscar usuário">
        <div class="chips" id="flt">${[['all', 'Todos'], ['online', 'Online'], ['offline', 'Offline'], ['blocked', 'Bloqueados'], ['admin', 'Admins']]
          .map(([k, l]) => `<button class="chip ${k === 'all' ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      </div>
      <div class="utable" id="list"></div>
    </section>
    </div>
    <div id="tab-usage" hidden></div>
    <div class="drawer" id="drawer" hidden></div>`;

  const paintKpis = () => {
    const s = data.stats;
    const k = (v, l, cls = '') => `<div class="glass kpi-a ${cls}"><b>${v}</b><span>${l}</span></div>`;
    $app.querySelector('#kpis').innerHTML = k(s.users, 'Cadastrados') + k(s.online, 'Online agora', 'on') + k(s.live, 'Em aula por voz', 'live')
      + k(s.newToday, 'Novos hoje') + k(s.new7, 'Novos em 7 dias') + k(s.active7, 'Ativos em 7 dias') + k(s.lessonsToday, 'Atividades hoje');
    $app.querySelector('#upd').textContent = `Atualizado ${new Date().toLocaleTimeString('pt-BR')} · atualiza sozinho`;
  };

  const paintList = () => {
    const term = q.toLowerCase();
    const list = data.users.filter((u) => (!term || u.name.toLowerCase().includes(term) || u.email.includes(term))
      && (filter === 'all' || (filter === 'online' && u.status !== 'offline') || (filter === 'offline' && u.status === 'offline')
        || (filter === 'blocked' && u.blocked) || (filter === 'admin' && u.isAdmin)));
    $app.querySelector('#list').innerHTML = list.length ? `
      <div class="urow uhead"><span>Usuário</span><span>Status</span><span class="hide-sm">Idiomas</span><span class="hide-sm">Atividades</span><span class="hide-sm">Cadastro</span></div>
      ${list.map((u) => `<button class="urow" data-u="${u.id}">
        <span class="uname"><span class="me-av sm">${esc(u.name.slice(0, 1).toUpperCase())}</span><span><b>${esc(u.name)}</b>${u.isAdmin ? ' <em class="badge-a">admin</em>' : ''}${u.blocked ? ' <em class="badge-a red">bloqueado</em>' : ''}<small>${esc(u.email)}</small></span></span>
        <span class="ustatus">${dot(u.status)}<span>${STATUS[u.status]}<small>${u.status === 'offline' ? `visto ${ago(u.lastSeenAt)}` : ''}</small></span></span>
        <span class="hide-sm">${u.languages.length ? u.languages.map((l) => `<span class="tag">${esc(l.slug === 'english' ? 'EN' : 'ES')} ${esc(l.level)}</span>`).join(' ') : '<span class="muted small">—</span>'}</span>
        <span class="hide-sm">${u.lessons}</span>
        <span class="hide-sm small muted">${new Date(u.createdAt).toLocaleDateString('pt-BR')}</span>
      </button>`).join('')}` : '<p class="muted center">Ninguém encontrado.</p>';
    $app.querySelectorAll('[data-u]').forEach((b) => { b.onclick = () => openUser(Number(b.dataset.u)); });
  };

  async function load() {
    try { data = await api('/admin/overview'); paintKpis(); paintList(); } catch (e) { toast(e.message, { type: 'err' }); }
  }

  const drawer = $app.querySelector('#drawer');
  const closeDrawer = () => { drawer.hidden = true; openId = null; };

  async function openUser(uid) {
    openId = uid;
    drawer.hidden = false;
    drawer.innerHTML = '<div class="drawer-in glass"><p class="muted">Carregando…</p></div>';
    let u;
    try { u = await api(`/admin/users/${uid}`); } catch (e) { toast(e.message, { type: 'err' }); return closeDrawer(); }
    const self = u.id === state.me.id;
    drawer.innerHTML = `<div class="drawer-bg" data-x></div>
      <aside class="drawer-in glass" role="dialog" aria-label="Detalhes de ${esc(u.name)}">
        <div class="spread"><span class="eyebrow violet">USUÁRIO #${u.id}</span><button class="icon-btn" data-x aria-label="Fechar">${icon('x', 18)}</button></div>
        <div class="d-head"><span class="me-av lg">${esc(u.name.slice(0, 1).toUpperCase())}</span><div><h2>${esc(u.name)}</h2><div class="muted small">${esc(u.email)}</div>
          <div class="ustatus" style="margin-top:6px">${dot(u.status)}<span>${STATUS[u.status]}${u.status === 'offline' ? ` · visto ${ago(u.lastSeenAt)}` : ''}</span></div></div></div>
        <div class="d-grid"><div><small>Cadastro</small><b>${date(u.createdAt)}</b></div><div><small>Último acesso</small><b>${date(u.lastSeenAt)}</b></div></div>
        <h3>Idiomas</h3>
        ${u.languages.length ? u.languages.map((l) => `<div class="d-lang"><b>${esc(l.name)}</b><span class="tag">${esc(l.level)}</span><span class="small muted">${l.xp} XP · ${l.streak} dia(s) seguidos${l.teacher ? ` · prof. ${esc(l.teacher)}` : ''}</span></div>`).join('') : '<p class="muted small">Ainda não escolheu um idioma.</p>'}
        <h3>Uso da IA</h3>
        <div class="d-grid">
          <div><small>Voz hoje</small><b>${Math.round(u.usage.voiceToday / 60)} / ${u.usage.limit == null ? '∞' : u.usage.limit} min</b></div>
          <div><small>Voz em 30 dias</small><b>${Math.round(u.usage.voice30 / 60)} min</b></div>
          <div><small>Custo no mês</small><b>${(u.usage.costMonth * u.usage.usdBrl).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</b></div>
          <div><small>Custo total</small><b>${(u.usage.costTotal * u.usage.usdBrl).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</b></div>
        </div>
        <form class="limit-form" id="lim">
          <label for="limv">Limite de voz por dia</label>
          <div class="limit-row"><input id="limv" type="number" min="0" max="600" step="5" inputmode="numeric" value="${u.usage.customLimit ?? ''}" placeholder="${u.isAdmin ? '∞' : u.usage.defaultLimit}"><span class="muted small">min</span>
            <button class="btn sm accent">Salvar</button>${u.usage.customLimit != null ? '<button type="button" class="btn ghost sm" id="limd">Voltar ao padrão</button>' : ''}</div>
          <small class="muted">${u.usage.customLimit != null ? 'Limite próprio deste usuário.' : `Usando o padrão${u.isAdmin ? ' (admin: sem limite)' : ` de ${u.usage.defaultLimit} min`}. Deixe vazio para manter.`}</small>
        </form>
        <h3>Atividades recentes</h3>
        ${u.recent.length ? `<ul class="list">${u.recent.map((r) => `<li class="spread"><span>${esc(MODE[r.mode] || r.mode)} · ${esc(r.topic)}</span><span class="small muted">${date(r.startedAt)}${r.completedAt ? '' : ' · aberta'}</span></li>`).join('')}</ul>` : '<p class="muted small">Nenhuma ainda.</p>'}
        <h3>Gerenciar</h3>
        <div class="d-actions">
          ${self ? '<p class="small muted">Esta é a sua conta.</p>' : `
          <button class="btn ghost sm" data-a="block">${u.blocked ? 'Desbloquear' : 'Bloquear acesso'}</button>
          <button class="btn ghost sm" data-a="admin">${u.isAdmin ? 'Remover admin' : 'Tornar admin'}</button>`}
          <button class="btn ghost sm" data-a="pass">Redefinir senha</button>
          ${self ? '' : '<button class="btn sm danger" data-a="del">Excluir conta</button>'}
        </div>
      </aside>`;
    drawer.querySelectorAll('[data-x]').forEach((b) => { b.onclick = closeDrawer; });
    const act = async (fn, msg) => { try { await fn(); toast(msg, { type: 'ok' }); await load(); usagePanel?.reload(); if (openId) openUser(uid); } catch (e) { toast(e.message, { type: 'err' }); } };
    drawer.querySelector('[data-a="block"]')?.addEventListener('click', async () => {
      if (!u.blocked && !(await confirmDialog(`Bloquear ${u.name}? A pessoa não vai conseguir entrar até você desbloquear.`, { okText: 'Bloquear', danger: true }))) return;
      act(() => api(`/admin/users/${uid}`, { method: 'PATCH', body: { blocked: !u.blocked } }), u.blocked ? 'Conta desbloqueada' : 'Conta bloqueada');
    });
    drawer.querySelector('[data-a="admin"]')?.addEventListener('click', async () => {
      if (!u.isAdmin && !(await confirmDialog(`Dar acesso de administrador para ${u.name}?`, { okText: 'Dar acesso' }))) return;
      act(() => api(`/admin/users/${uid}`, { method: 'PATCH', body: { isAdmin: !u.isAdmin } }), u.isAdmin ? 'Admin removido' : 'Agora é admin');
    });
    drawer.querySelector('#lim').onsubmit = (e) => {
      e.preventDefault();
      const raw = drawer.querySelector('#limv').value.trim();
      if (raw === '') return toast('Digite os minutos por dia', { type: 'info' });
      act(() => api(`/admin/users/${uid}`, { method: 'PATCH', body: { voiceDailyMinutes: Number(raw) } }), `Limite de voz: ${raw} min por dia`);
    };
    drawer.querySelector('#limd')?.addEventListener('click', () => act(() => api(`/admin/users/${uid}`, { method: 'PATCH', body: { voiceDailyMinutes: null } }), 'Limite de voz voltou ao padrão'));
    drawer.querySelector('[data-a="pass"]').onclick = async () => {
      const p = await promptDialog(`Nova senha para ${u.name} (mínimo 8 caracteres):`, { input: { type: 'password', placeholder: 'Nova senha' }, okText: 'Alterar senha' });
      if (p) act(() => api(`/admin/users/${uid}/password`, { body: { password: p } }), 'Senha alterada');
    };
    drawer.querySelector('[data-a="del"]')?.addEventListener('click', async () => {
      if ((await promptDialog(`Isso apaga ${u.name} e TODO o progresso, sem volta. Digite EXCLUIR para confirmar:`, { input: { placeholder: 'EXCLUIR' }, okText: 'Excluir conta', danger: true }))?.trim() !== 'EXCLUIR') return;
      act(async () => { await api(`/admin/users/${uid}`, { method: 'DELETE' }); closeDrawer(); }, 'Conta excluída');
    });
  }

  $app.querySelector('#q').oninput = (e) => { q = e.target.value; paintList(); };
  $app.querySelectorAll('[data-f]').forEach((b) => {
    b.onclick = () => { filter = b.dataset.f; $app.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b)); paintList(); };
  });

  let usagePanel = null;
  $app.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = async () => {
      const tab = b.dataset.tab;
      $app.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      $app.querySelector('#tab-users').hidden = tab !== 'users';
      $app.querySelector('#tab-usage').hidden = tab !== 'usage';
      if (tab === 'usage') {
        if (!usagePanel) usagePanel = await viewUsage($app.querySelector('#tab-usage'), { openUser });
        else usagePanel.reload();
      }
    };
  });

  await load();
  // Atualiza sozinho enquanto a página estiver aberta
  timer = setInterval(() => { if (location.pathname !== '/admin') return clearInterval(timer); if (!document.hidden) load(); }, 20000);
}
