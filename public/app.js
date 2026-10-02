// Roteador da SPA
import { $app, esc, api, go, state, setNavigator, icon } from './js/core.js';
import { viewLogin, viewHome, viewPlacement } from './js/views/start.js';
import { viewDashboard } from './js/views/dashboard.js';
import { viewSession } from './js/views/session.js';
import { viewConversation, viewRoleplay } from './js/views/practice.js';
import { viewVocab } from './js/views/vocab.js';
import { viewPronunciation } from './js/views/pronunciation.js';
import { viewMaterials, viewMaterial } from './js/views/material.js';
import { viewReport } from './js/views/report.js';
import { viewLiveSetup } from './js/views/live.js';
import { viewTeachers } from './js/views/teachers.js';
import { viewTutor } from './js/views/tutor.js';
import { viewAdmin } from './js/views/admin.js';
import { bindInstall } from './js/install.js';

const SECTIONS = {
  nivelamento: viewPlacement,
  'ao-vivo': viewLiveSetup,
  professores: viewTeachers,
  chat: viewTutor,
  conversa: viewConversation,
  roleplay: viewRoleplay,
  vocabulario: viewVocab,
  pronuncia: viewPronunciation,
  material: viewMaterials,
  relatorio: viewReport,
};

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && a.origin === location.origin && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.pathname + a.hash); }
});
window.addEventListener('popstate', route);
setNavigator(route);

const SIDE = [
  ['', 'Início', 'home'], ['ao-vivo', 'Conversar por voz', 'mic'], ['chat', 'Chat livre', 'chat'], ['professores', 'Professores', 'user'],
  ['vocabulario', 'Flashcards', 'cards'], ['pronuncia', 'Pronúncia', 'wave'], ['material', 'Foto do exercício', 'camera'],
  ['conversa', 'Conversa guiada', 'guide'], ['roleplay', 'Roleplay', 'mask'], ['relatorio', 'Relatório', 'chart'],
];
const BOTTOM = [['', 'Início', 'home'], ['ao-vivo', 'Voz', 'mic'], ['chat', 'Chat', 'chat'], ['relatorio', 'Progresso', 'chart']];

// Estrutura da tela: topo (fora de um idioma), menu lateral no computador e barra inferior no celular (dentro de um idioma)
function setTop(lang, section) {
  const top = document.getElementById('topbar');
  const side = document.getElementById('side');
  const bottom = document.getElementById('bottomnav');
  const inLang = !!(state.me && lang);
  document.body.classList.toggle('shell', inLang);
  document.body.classList.toggle('immersive', inLang && (section === 'aula' || section === 'chat'));
  top.hidden = !state.me;
  side.hidden = !inLang;
  bottom.hidden = !inLang;
  const langs = state.me ? state.meta.languages.map((l) => `<a href="/${l.slug}" data-link class="${lang?.slug === l.slug ? 'on' : ''}">${l.code ? esc(l.code.toUpperCase()) : l.flag}</a>`).join('') : '';
  const adm = state.me?.isAdmin ? `<a href="/admin" data-link class="admin-link" title="Painel de admin">${icon('shield', 18)}<span class="hide-sm">Admin</span></a>` : '';
  const inst = `<button class="install-btn js-install" hidden title="Instalar o app">${icon('download', 18)}<span class="hide-sm">Instalar app</span></button>`;
  document.getElementById('topnav').innerHTML = state.me ? `${inst}${adm}<div class="langpill">${langs}</div><button id="logout" aria-label="Sair">${icon('logout', 18)}</button>` : '';
  if (inLang) {
    const cur = section || '';
    side.innerHTML = `<a href="/" class="brand" data-link><i class="sphere" aria-hidden="true"></i><span>Speak AI</span></a>
      <nav aria-label="Seções">${SIDE.map(([p, l, i]) => `<a href="/${lang.slug}${p ? '/' + p : ''}" data-link class="side-a ${cur === p ? 'on' : ''}">${icon(i)}${l}</a>`).join('')}</nav>
      <div class="side-foot"><button class="side-a js-install" hidden>${icon('download')}Instalar o app</button>${state.me.isAdmin ? `<a href="/admin" data-link class="side-a">${icon('shield')}Painel de admin</a>` : ''}<div class="langpill">${langs}</div>
        <div class="me"><span class="me-av">${esc(state.me.name.slice(0, 1).toUpperCase())}</span><div><b>${esc(state.me.name.split(' ')[0])}</b><div class="small muted">${esc(lang.namePt)}</div></div>
        <button id="logout2" class="icon-btn" aria-label="Sair">${icon('logout', 18)}</button></div></div>`;
    bottom.innerHTML = BOTTOM.map(([p, l, i]) => `<a href="/${lang.slug}${p ? '/' + p : ''}" data-link class="${cur === p ? 'on' : ''}">${icon(i, 22)}${l}</a>`).join('');
  }
  const out = async () => { await api('/auth/logout', { method: 'POST' }); state.me = null; go('/login'); };
  document.getElementById('logout')?.addEventListener('click', out);
  document.getElementById('logout2')?.addEventListener('click', out);
  bindInstall();
}

async function route() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  try {
    if (!state.meta) state.meta = await api('/meta');
    if (state.me === null) state.me = await api('/auth/me').then((r) => r.user).catch(() => false);
  } catch { /* offline: segue com o que tiver */ }
  if (!state.me && path !== '/login') return go('/login');
  if (state.me && path === '/login') return go('/');
  const [, slug, section, sub, extra] = path.split('/');
  const lang = state.meta.languages.find((l) => l.slug === slug);
  setTop(lang, section);
  document.body.classList.toggle('landing', path === '/login');
  $app.className = 'container';
  window.scrollTo(0, 0);
  try {
    if (path === '/login') return viewLogin();
    if (path === '/') return viewHome();
    if (path === '/admin') return await viewAdmin();
    if (!lang || extra) throw new Error('Página não encontrada');
    if (!section) return await viewDashboard(lang);
    if (section === 'aula' && /^\d+$/.test(sub || '')) return await viewSession(slug, Number(sub));
    if (section === 'material' && /^\d+$/.test(sub || '')) return await viewMaterial(lang, Number(sub));
    if (SECTIONS[section] && !sub) {
      // Seções (exceto nivelamento) exigem o idioma configurado
      if (section !== 'nivelamento') {
        const d = await api(`/languages/${slug}/dashboard`);
        if (!d.enrolled) return go(`/${slug}`);
      }
      return await SECTIONS[section](lang);
    }
    throw new Error('Página não encontrada');
  } catch (e) {
    $app.innerHTML = `<p class="center muted" style="margin-top:10vh">${esc(e.message)}<br><a href="/" data-link>Voltar ao início</a></p>`;
  }
}

route();

// Mantém o "online" do painel de admin enquanto a aba estiver aberta
setInterval(() => { if (state.me && !document.hidden) api('/auth/ping', { method: 'POST' }).catch(() => {}); }, 60000);
document.addEventListener('visibilitychange', () => { if (state.me && !document.hidden) api('/auth/ping', { method: 'POST' }).catch(() => {}); });
