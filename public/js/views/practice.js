// Configuração de conversa livre e escolha de cenário de roleplay
import { $app, esc, api, state, langNav } from '../core.js';
import { startActivity } from './dashboard.js';
import { teacherStrip, bindTeacherStrip } from './teachers.js';

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignora */ } };

function autoplayToggle() {
  return `<label class="check"><input type="checkbox" id="autoplay" ${lsGet('autoplay') === '1' ? 'checked' : ''}> 🔊 Ler as falas do professor em voz alta</label>`;
}
function bindAutoplay() {
  $app.querySelector('#autoplay').onchange = (e) => lsSet('autoplay', e.target.checked ? '1' : '0');
}
function turnsSelect(def) {
  return `<select id="turns" aria-label="Duração">${state.meta.turnOptions.map((t) =>
    `<option value="${t}" ${t === def ? 'selected' : ''}>${t} falas (${t === 6 ? '~5' : t === 10 ? '~10' : '~15'} min)</option>`).join('')}</select>`;
}

export async function viewConversation(lang) {
  const d = await api(`/languages/${lang.slug}/dashboard`);
  let topic = 'surprise';
  $app.innerHTML = `
    ${langNav(lang, 'conversa')}
    <div class="card stack">
      <div><h1>💬 Conversa livre</h1><p class="muted">O professor conduz a conversa no tema que você escolher e corrige sem travar a fluidez: erros importantes você tenta de novo, detalhes viram anotações.</p></div>
      <div class="field"><label>Tema</label>
        <div class="chips"><button type="button" class="chip on" data-t="surprise">🎲 Surpreenda-me</button>
        ${state.meta.topics.map((t) => `<button type="button" class="chip" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
      <div class="field"><label for="turns">Duração</label>${turnsSelect(6)}</div>
      ${autoplayToggle()}
      <button class="btn accent" id="go">Começar a conversa</button>
    </div>
    <div style="margin-top:16px">${teacherStrip(lang, d)}</div>`;
  bindTeacherStrip($app, lang, () => viewConversation(lang));
  $app.querySelectorAll('.chip').forEach((c) => {
    c.onclick = () => { $app.querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); c.classList.add('on'); topic = c.dataset.t; };
  });
  bindAutoplay();
  $app.querySelector('#go').onclick = (e) => startActivity(`/languages/${lang.slug}/conversations`,
    { mode: 'conversation', topic, turns: Number($app.querySelector('#turns').value) }, e.target, 'O professor está entrando na sala…');
}

export function viewRoleplay(lang) {
  $app.innerHTML = `
    ${langNav(lang, 'roleplay')}
    <div class="stack">
      <div><h1>🎭 Roleplay</h1><p class="muted">O professor interpreta um personagem e só sai do papel para ensinar. No final você recebe notas de gramática, vocabulário, adequação e fluidez.</p></div>
      <div class="card stack"><div class="row-form"><label for="turns" style="margin:0">Duração máxima</label>${turnsSelect(10)}</div>${autoplayToggle()}</div>
      <div class="scenarios">
        <button class="card scenario" data-s="surprise"><span>🎲</span><b>Surpreenda-me</b><small>Um cenário aleatório</small></button>
        ${state.meta.scenarios.map((s) => `<button class="card scenario" data-s="${esc(s.id)}"><span>${s.emoji}</span><b>${esc(s.namePt)}</b><small>${esc(s.goalPt)}</small></button>`).join('')}
      </div>
    </div>`;
  bindAutoplay();
  $app.querySelectorAll('.scenario').forEach((b) => {
    b.onclick = () => {
      $app.querySelectorAll('.scenario').forEach((x) => { x.disabled = true; });
      b.querySelector('small').textContent = 'Preparando a cena…';
      startActivity(`/languages/${lang.slug}/conversations`, { mode: 'roleplay', scenario: b.dataset.s, turns: Number($app.querySelector('#turns').value) })
        .finally(() => $app.querySelectorAll('.scenario').forEach((x) => { x.disabled = false; }));
    };
  });
}
