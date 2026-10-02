// Login, escolha do idioma, configuração inicial e teste de nivelamento
import { $app, esc, api, go, toast, state, bar, icon, ring } from '../core.js';
import { bindInstall } from '../install.js';

const G_LOGO = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

export function viewLogin() {
  const qs = new URLSearchParams(location.search);
  const resetToken = qs.get('redefinir');
  let mode = resetToken ? 'reset' : 'login';
  const erro = qs.get('erro');
  if (erro || resetToken) history.replaceState({}, '', '/login');
  if (erro) setTimeout(() => toast(erro, { type: 'err' }));
  const back = `<button type="button" class="linkish" data-m="login">${icon('arrow', 14)}Voltar para o login</button>`;
  const authForm = () => {
    if (mode === 'forgot') return `
      <b class="h3">Esqueceu a senha?</b>
      <p class="muted small">Informe seu e-mail. Mandamos um link para você criar uma senha nova.</p>
      <div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" required autocomplete="email"></div>
      <div class="field"><button class="btn accent block glow">Enviar link ${icon('arrow', 18)}</button></div>${back}`;
    if (mode === 'sent') return `
      <b class="h3">Confira seu e-mail</b>
      <p class="muted small">Se houver uma conta com esse e-mail, o link para criar uma senha nova chega em instantes. Ele vale por 1 hora. Olhe também a caixa de spam.</p>${back}`;
    if (mode === 'reset') return `
      <b class="h3">Crie uma senha nova</b>
      <div class="field"><label for="password">Senha nova</label><input id="password" name="password" type="password" required minlength="8" autocomplete="new-password"></div>
      <div class="field"><label for="password2">Repita a senha</label><input id="password2" name="password2" type="password" required minlength="8" autocomplete="new-password"></div>
      <div class="field"><button class="btn accent block glow">Salvar e entrar ${icon('arrow', 18)}</button></div>${back}`;
    return `
      <div class="seg"><button type="button" data-m="login" class="${mode === 'login' ? 'on' : ''}">Entrar</button>
        <button type="button" data-m="register" class="${mode === 'register' ? 'on' : ''}">Criar conta</button></div>
      <div class="js-google" hidden><a href="/api/auth/google" class="btn block gbtn">${G_LOGO}Continuar com Google</a>
        <div class="or"><span>ou com e-mail</span></div></div>
      ${mode === 'register' ? '<div class="field"><label for="name">Nome</label><input id="name" name="name" required autocomplete="name"></div>' : ''}
      <div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" required autocomplete="email"></div>
      <div class="field"><label for="password">Senha</label><input id="password" name="password" type="password" required minlength="8" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">
        ${mode === 'login' ? '<button type="button" class="linkish forgot" data-m="forgot">Esqueceu a senha?</button>' : ''}</div>
      <div class="field"><button class="btn accent block glow">${mode === 'login' ? 'Entrar' : 'Começar grátis'} ${icon('arrow', 18)}</button></div>`;
  };
  api('/auth/options').then((o) => {
    state.googleOn = o.google;
    if (o.google) $app.querySelectorAll('.js-google').forEach((el) => { el.hidden = false; });
  }).catch(() => {});
  const render = () => {
    $app.className = 'landing-wrap';
    $app.innerHTML = `
      <header class="land-top"><span class="brand"><img src="/icons/icon-192.png" alt="" class="brand-ico"><span>Speak AI</span></span>
        <button class="install-btn js-install" hidden>${icon('download', 18)}Instalar o app</button></header>
      <div class="land">
        <section class="land-copy">
          <span class="pill-new"><b>NOVO</b>Conversa por voz em tempo real</span>
          <h1 class="mega">Fale. Erre.<br>Aprenda<span class="dot">.</span><br><span class="grad-text">Ao vivo.</span></h1>
          <p class="lead">Um professor particular de inglês e espanhol que conversa com você por voz, corrige na hora, explica em português e lembra de cada aula.</p>
          <form class="glass auth" id="f">${authForm()}</form>
          <div class="feats"><span>${icon('mic', 18)}Voz com voz</span><span>${icon('book', 18)}Modo fonético</span><span>${icon('chart', 18)}Memória entre aulas</span></div>
        </section>

        <section class="scene" aria-hidden="true">
          <div class="scene-core">
            <i class="orbit o1"></i><i class="orbit o2"></i><i class="orbit o3"></i>
            <i class="sphere hero-orb"></i><i class="orb-shadow"></i>
            <span class="listening">OUVINDO…</span>
          </div>
          <div class="glass float f1"><span class="eyebrow orange">${icon('pen', 14)}CORREÇÃO</span>
            <s class="muted">Yesterday I go to the beach</s><b>Yesterday I <em>went</em> to the beach</b><small class="muted">Ontem = passado. “Go” vira “went”.</small></div>
          <div class="glass float f2"><span class="eyebrow violet">MODO FONÉTICO</span><b class="h3">the weather</b>
            <div class="readas"><small>LEIA ASSIM</small><b>dê UÉ-dhər</b></div><code>/ðə ˈwɛðər/</code></div>
          <div class="glass float f3"><span class="flame big">${icon('flame', 22)}</span><div><b class="h3">12 dias</b><small class="muted">de sequência</small></div></div>
          <div class="glass float f4"><i class="sphere"></i><div><b>Kore</b> está falando<br><small class="muted">“So, how was your trip?”</small></div></div>
        </section>
      </div>
      <footer class="land-foot">
        <div class="glass card-pad"><b class="h3">30 professores</b><p class="muted small">Cada um com voz e personalidade próprias. Ouça e escolha o seu.</p></div>
        <div class="glass card-pad"><b class="h3">Explica em português</b><p class="muted small">A conversa é em inglês; as regras e correções, na sua língua.</p></div>
        <div class="glass card-pad"><b class="h3">Mande foto do livro</b><p class="muted small">O professor lê o exercício e resolve com você, sem entregar a resposta.</p></div>
      </footer>`;
    $app.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { mode = b.dataset.m; render(); }; });
    if (state.googleOn) $app.querySelectorAll('.js-google').forEach((el) => { el.hidden = false; });
    bindInstall($app);
    $app.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('.btn'); btn.disabled = true;
      const body = Object.fromEntries(new FormData(e.target));
      try {
        if (mode === 'forgot') { await api('/auth/forgot', { body }); mode = 'sent'; return render(); }
        if (mode === 'reset') {
          if (body.password !== body.password2) throw new Error('As senhas não são iguais');
          state.me = (await api('/auth/reset', { body: { token: resetToken, password: body.password } })).user;
          toast('Senha alterada!', { type: 'ok' });
          return go('/');
        }
        state.me = (await api(`/auth/${mode}`, { body })).user;
        go('/');
      } catch (err) { toast(err.message, { type: 'err' }); btn.disabled = false; }
    };
  };
  render();
}

export async function viewHome() {
  const boards = await Promise.all(state.meta.languages.map((l) => api(`/languages/${l.slug}/dashboard`)));
  $app.innerHTML = `
    <h1>Olá, ${esc(state.me.name.split(' ')[0])}</h1>
    <p class="muted">Escolha o idioma de hoje. Cada um tem seu próprio progresso.</p>
    <button class="glass install-card js-install" hidden><img src="/icons/icon-192.png" alt="" width="52" height="52"><span><b>Instale o Speak AI no celular</b><small>Abre em tela cheia, direto da tela inicial, como um app.</small></span>${icon('download', 22)}</button>
    <div class="grid2">${boards.map((d) => `
      <a href="/${d.language.slug}" class="glass lang-card" data-link>
        ${d.enrolled ? ring(d.progress, 96, esc(d.level), `${d.progress}%`) : '<i class="sphere xl"></i>'}
        <div style="flex:1"><h2>${esc(d.language.namePt)}</h2>
        ${d.enrolled
          ? `<p class="muted small">${d.streak} dia(s) de sequência · ${d.xp} XP</p>
             <p class="small">Meta de hoje: <b>${d.goals.daily.value}/${d.goals.daily.goal} XP</b>${d.goals.daily.done ? ' · concluída' : ''}</p>`
          : '<p class="muted small">Começar agora →</p>'}</div>
      </a>`).join('')}</div>`;
  bindInstall($app);
}

export function viewOnboarding(lang, profile, placementResult) {
  const editing = !!profile;
  const p = profile || { level: placementResult?.level || 'A1', goal: 'conversacao', teachingStyle: 'balanced', interests: [], dailyGoalXp: 50, weeklyGoalLessons: 5 };
  const interests = new Set(p.interests);
  const { meta } = state;
  $app.innerHTML = `
    <form class="card stack" id="f" style="max-width:580px;margin:0 auto">
      <div><div style="font-size:2.4rem">${lang.flag}</div><h1>${editing ? 'Ajustar' : 'Vamos começar'} — ${esc(lang.namePt)}</h1>
        <p class="muted">${editing ? 'O professor adapta o plano ao seu objetivo, estilo e metas.' : 'Conte um pouco sobre você para o professor montar suas aulas.'}</p></div>
      <div class="field"><label>Seu nível</label>
        ${placementResult ? `<div class="hint">🎯 Teste de nivelamento: <b>${esc(placementResult.level)}</b> (confiança ${placementResult.confidence}%)</div>` : ''}
        <select name="level">
        ${[['A1', 'A1 — Estou começando'], ['A2', 'A2 — Entendo frases simples'], ['B1', 'B1 — Consigo conversar sobre o dia a dia']]
          .map(([v, t]) => `<option value="${v}" ${p.level === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
        ${!editing && !placementResult ? `<p class="small" style="margin-top:8px">Não sabe seu nível? <a href="/${lang.slug}/nivelamento" data-link><b>Faça o teste de nivelamento</b></a> (6 perguntas, ~5 min).</p>` : ''}
        ${editing ? `<p class="small" style="margin-top:8px"><a href="/${lang.slug}/nivelamento" data-link>Refazer o teste de nivelamento</a></p>` : ''}</div>
      <div class="field"><label>Seu objetivo</label><select name="goal">
        ${Object.entries(meta.goals).map(([k, v]) => `<option value="${k}" ${p.goal === k ? 'selected' : ''}>${esc(v[0].toUpperCase() + v.slice(1))}</option>`).join('')}</select></div>
      <div class="field"><label>Estilo do professor</label><select name="teachingStyle">
        <option value="friendly" ${p.teachingStyle === 'friendly' ? 'selected' : ''}>Amigável — corrige o essencial</option>
        <option value="balanced" ${p.teachingStyle === 'balanced' ? 'selected' : ''}>Equilibrado</option>
        <option value="strict" ${p.teachingStyle === 'strict' ? 'selected' : ''}>Rígido — cobra mais repetição</option></select></div>
      <div class="grid2" style="gap:12px">
        <div class="field" style="margin:0"><label>Meta diária</label><select name="dailyGoalXp">
          ${[[30, 'Leve — 30 XP'], [50, 'Regular — 50 XP'], [100, 'Puxada — 100 XP'], [150, 'Intensa — 150 XP']].map(([v, t]) => `<option value="${v}" ${p.dailyGoalXp === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field" style="margin:0"><label>Aulas por semana</label><select name="weeklyGoalLessons">
          ${[2, 3, 5, 7, 10].map((v) => `<option value="${v}" ${p.weeklyGoalLessons === v ? 'selected' : ''}>${v} aulas</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Do que você gosta? (temas das conversas)</label>
        <div class="chips">${meta.topics.map((t) => `<button type="button" class="chip ${interests.has(t) ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
      <div style="display:flex;gap:8px">${editing ? `<a class="btn ghost" href="/${lang.slug}" data-link>Cancelar</a>` : ''}<button class="btn accent" style="flex:1">${editing ? 'Salvar' : 'Começar'}</button></div>
    </form>`;
  $app.querySelectorAll('.chip').forEach((c) => {
    c.onclick = () => { interests.has(c.dataset.t) ? interests.delete(c.dataset.t) : interests.add(c.dataset.t); c.classList.toggle('on'); };
  });
  $app.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    const body = { ...Object.fromEntries(new FormData(e.target)), interests: [...interests] };
    body.dailyGoalXp = Number(body.dailyGoalXp); body.weeklyGoalLessons = Number(body.weeklyGoalLessons);
    if (placementResult && body.level === placementResult.level) body.fromPlacement = true;
    try {
      await api(`/languages/${lang.slug}/${editing ? 'profile' : 'enroll'}`, { method: editing ? 'PATCH' : 'POST', body });
      go(`/${lang.slug}`);
    } catch (err) { toast(err.message, { type: 'err' }); }
  };
}

export async function viewPlacement(lang) {
  $app.innerHTML = `<div class="card center stack" style="max-width:560px;margin:0 auto"><div style="font-size:2.4rem">🎯</div>
    <h1>Teste de nivelamento</h1><p class="muted">O professor vai fazer 6 perguntas que se adaptam às suas respostas. Responda do jeito que conseguir — sem tradutor!</p>
    <button class="btn accent" id="go">Começar o teste</button></div>`;
  $app.querySelector('#go').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Preparando as perguntas…';
    try { render(await api(`/languages/${lang.slug}/placement`, { method: 'POST' })); } catch (err) { toast(err.message, { type: 'err' }); e.target.disabled = false; e.target.textContent = 'Começar o teste'; }
  };

  function render(t) {
    if (t.completed) return result(t);
    $app.innerHTML = `
      <div class="card stack" style="max-width:620px;margin:0 auto">
        <div class="small muted">Pergunta ${t.answered + 1} de ${t.total} · ${esc({ grammar: 'gramática', vocabulary: 'vocabulário', reading: 'leitura' }[t.question.area] || '')}</div>
        ${bar((t.answered / t.total) * 100)}
        ${t.lastFeedback ? `<div class="hint small">💬 ${esc(t.lastFeedback)}</div>` : ''}
        <div class="q prewrap">${esc(t.question.prompt)}</div>
        ${t.question.instructionPt ? `<div class="muted">🇧🇷 ${esc(t.question.instructionPt)}</div>` : ''}
        <form id="f" class="stack"><textarea id="a" rows="3" placeholder="Sua resposta em ${esc(lang.name)}…" aria-label="Resposta"></textarea>
          <div style="display:flex;gap:8px"><button type="button" class="btn ghost" id="skip">Não sei</button><button class="btn" style="flex:1">Responder</button></div></form>
      </div>`;
    const send = async (answer) => {
      $app.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try { render(await api(`/placement/${t.id}/answer`, { body: { answer } })); } catch (err) { toast(err.message, { type: 'err' }); $app.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
    };
    $app.querySelector('#f').onsubmit = (e) => { e.preventDefault(); const a = $app.querySelector('#a').value.trim(); if (a) send(a); };
    $app.querySelector('#skip').onclick = () => send('não sei');
    $app.querySelector('#a').focus();
  }

  async function result(t) {
    const r = t.result;
    const d = await api(`/languages/${lang.slug}/dashboard`);
    const areas = Object.entries(r.byArea || {}).map(([k, v]) => `<div class="area"><span>${esc({ grammar: 'Gramática', vocabulary: 'Vocabulário', reading: 'Leitura' }[k] || k)}</span>${bar(v)}<span class="small">${v}%</span></div>`).join('');
    $app.innerHTML = `
      <div class="card stack center" style="max-width:560px;margin:0 auto">
        <div style="font-size:2.4rem">${lang.flag}</div>
        <div class="small muted">SEU NÍVEL ESTIMADO</div>
        <div class="levelbig">${esc(r.level)}</div>
        <p>Confiança: <b>${r.confidence}%</b>${r.demonstrated !== r.level ? ` · você mostrou sinais de ${esc(r.demonstrated)}!` : ''}</p>
        <div style="text-align:left">${areas}</div>
        <p class="muted small">O nível continua se ajustando com o seu desempenho nas aulas.</p>
        ${d.enrolled ? `<p class="hint">Seu nível em ${esc(lang.namePt)} foi atualizado para <b>${esc(r.level)}</b>.</p><a class="btn accent" href="/${lang.slug}" data-link>Ir para o painel</a>`
          : '<button class="btn accent" id="cont">Continuar</button>'}
      </div>`;
    $app.querySelector('#cont')?.addEventListener('click', () => viewOnboarding(lang, null, r));
  }
}
