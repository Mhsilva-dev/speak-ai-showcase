// Instalação do app (PWA). Todo elemento .js-install vira um botão "Instalar o app":
//  - Chrome/Edge (Android e computador): abre a janela de instalação do navegador;
//  - iPhone/iPad, navegador dentro do WhatsApp/Instagram ou sem suporte: mostra o passo a passo certo.
// Os botões somem quando o app já está aberto instalado.
import { icon, toast } from './core.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

let deferred = null;
const ua = navigator.userAgent || '';
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const isMobile = isIOS || isAndroid || /Mobi/i.test(ua);
const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)|GSA\//i.test(ua);
const isSafariIOS = isIOS && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua) && !inApp;

export const installed = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
/** Mostrar botão? Sempre no celular (há instruções); no computador só quando o navegador oferece */
export const canInstall = () => !installed() && (isMobile || !!deferred);

export function refreshInstallButtons() {
  document.querySelectorAll('.js-install').forEach((el) => { el.hidden = !canInstall(); });
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; refreshInstallButtons(); });
window.addEventListener('appinstalled', () => { deferred = null; closeHelp(); refreshInstallButtons(); toast('App instalado! Procure o Speak AI na tela inicial.', { type: 'ok' }); });

export async function installApp() {
  if (deferred) {
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    return refreshInstallButtons();
  }
  openHelp();
}

function steps() {
  const host = location.host;
  if (inApp) return { title: 'Abra no navegador para instalar', text: 'Você abriu o link por dentro de outro app (WhatsApp, Instagram…), que não deixa instalar.', steps: [
    'Toque nos <b>três pontinhos</b> (⋮ ou ⋯) no canto da tela.',
    isIOS ? 'Escolha <b>Abrir no Safari</b>.' : 'Escolha <b>Abrir no Chrome</b> (ou "Abrir no navegador").',
    'Na página que abrir, toque de novo em <b>Instalar o app</b>.'] };
  if (isIOS && !isSafariIOS) return { title: 'No iPhone, instale pelo Safari', text: 'O iPhone só deixa instalar apps de sites pelo Safari.', steps: [
    `Copie o endereço <b>${host}</b>.`, 'Abra o <b>Safari</b> e cole o endereço.',
    'Toque em <b>Compartilhar</b> (quadrado com seta para cima) e depois em <b>Adicionar à Tela de Início</b>.'] };
  if (isIOS) return { title: 'Instalar no iPhone', text: 'Leva 10 segundos:', steps: [
    'Toque no botão <b>Compartilhar</b> (quadrado com seta para cima) na barra do Safari.',
    'Role a lista e toque em <b>Adicionar à Tela de Início</b>.',
    'Toque em <b>Adicionar</b>. O Speak AI aparece na tela inicial.'] };
  if (isAndroid) return { title: 'Instalar no Android', text: 'Pelo menu do Chrome:', steps: [
    'Toque nos <b>três pontinhos (⋮)</b> no canto superior direito.',
    'Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.',
    'Confirme em <b>Instalar</b>. Se a opção não aparecer, abra o site no <b>Google Chrome</b>.'] };
  return { title: 'Instalar no computador', text: 'No Chrome ou no Edge:', steps: [
    'Clique no ícone de <b>instalar</b> (monitor com seta) no fim da barra de endereço,',
    'ou abra o menu <b>⋮</b> › <b>Transmitir, salvar e compartilhar</b> › <b>Instalar página como app</b>.',
    'Confirme em <b>Instalar</b>.'] };
}

function openHelp() {
  const info = steps();
  let m = document.getElementById('install-help');
  if (!m) {
    m = document.createElement('div');
    m.id = 'install-help';
    m.className = 'inst-overlay';
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeHelp(); });
    document.body.appendChild(m);
  }
  m.innerHTML = `<div class="inst-modal glass" role="dialog" aria-modal="true" aria-labelledby="inst-t">
    <div class="spread"><b id="inst-t" class="h3">${info.title}</b><button class="icon-btn" data-close aria-label="Fechar">${icon('x', 18)}</button></div>
    <div class="inst-app"><img src="/icons/icon-192.png" alt="" width="56" height="56"><div><b>Speak AI</b><small>Abre em tela cheia, como um app</small></div></div>
    <p class="muted">${info.text}</p>
    <ol class="inst-steps">${info.steps.map((s) => `<li><span>${s}</span></li>`).join('')}</ol>
    <button class="btn accent block" data-close>Entendi</button></div>`;
  m.hidden = false;
}

function closeHelp() { const m = document.getElementById('install-help'); if (m) m.hidden = true; }

/** Liga os botões .js-install que estiverem na tela */
export function bindInstall(root = document) {
  root.querySelectorAll('.js-install').forEach((b) => { b.onclick = installApp; });
  refreshInstallButtons();
}
