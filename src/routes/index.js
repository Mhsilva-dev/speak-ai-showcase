// Rotas da API (/api/...). Cada rota só valida o básico e chama o serviço; regras de negócio ficam em src/services.
// Proteção: requireAuth (logado), requireAdmin (admin) e limiter (limite de requisições por minuto).
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db/pool');
const authService = require('../services/auth.service');
const students = require('../services/student.service');
const lessons = require('../services/lesson.service');
const conversations = require('../services/conversation.service');
const live = require('../services/live.service');
const tutor = require('../services/tutor.service');
const placement = require('../services/placement.service');
const vocabulary = require('../services/vocabulary.service');
const materials = require('../services/material.service');
const reports = require('../services/report.service');
const pronunciation = require('../services/audio/pronunciation.service');
const tts = require('../services/audio/tts.service');
const { requireAuth, requireAdmin, setSession, clearSession } = require('../middleware/auth');
const admin = require('../services/admin.service');
const google = require('../services/google.service');
const weeklyEmail = require('../services/weekly-email.service');
const push = require('../services/push.service');
const usage = require('../services/usage.service');
const { LANGUAGES, TOPICS, GOALS, LEVELS } = require('../languages');
const SCENARIOS = require('../languages/scenarios');
const teachers = require('../languages/teachers');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const limiter = (max, windowMs = 60000) => (config.env === 'test'
  ? (req, res, next) => next()
  : rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.user?.id ? `u${req.user.id}` : req.ip, validate: false }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: materials.MAX_BYTES, files: 1 } });
const id = (req, key = 'id') => {
  const n = Number(req.params[key]);
  if (!Number.isInteger(n) || n <= 0) throw new students.HttpError(400, 'ID inválido');
  return n;
};

router.get('/health', (req, res) => res.json({ ok: true }));

// --- Autenticação: senha, "esqueci a senha" e sessão
router.post('/auth/register', limiter(10), wrap(async (req, res) => {
  const user = await authService.register(req.body || {});
  await setSession(req, res, user);
  res.status(201).json({ user });
}));
router.post('/auth/login', limiter(20), wrap(async (req, res) => {
  const user = await authService.login(req.body || {});
  await setSession(req, res, user);
  res.json({ user });
}));
router.post('/auth/forgot', limiter(5), wrap(async (req, res) => {
  await authService.forgotPassword(req.body?.email, config.appUrl || `${req.protocol}://${req.get('host')}`);
  res.json({ ok: true });
}));
router.post('/auth/reset', limiter(10), wrap(async (req, res) => {
  const user = await authService.resetPassword(req.body || {});
  await setSession(req, res, user);
  res.json({ user });
}));
router.post('/auth/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });
router.get('/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));
router.post('/auth/ping', requireAuth, (req, res) => res.json({ ok: true })); // mantém o "online" no painel de admin


// --- Login com Google (OAuth por redirecionamento; o state no cookie impede login forjado)
router.get('/auth/options', (req, res) => res.json({ google: google.enabled() }));
router.get('/auth/google', limiter(20), (req, res) => {
  if (!google.enabled()) return res.redirect('/login?erro=' + encodeURIComponent('Login com Google indisponível'));
  const state = google.newState();
  res.cookie('g_state', state, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 10 * 60000, path: '/api/auth/google' });
  res.redirect(google.authUrl(req, state));
});
router.get('/auth/google/callback', limiter(20), async (req, res) => {
  const fail = (msg) => res.redirect('/login?erro=' + encodeURIComponent(msg));
  const state = req.cookies?.g_state;
  res.clearCookie('g_state', { path: '/api/auth/google' });
  if (req.query.error) return fail('Login com Google cancelado');
  if (!state || state !== req.query.state || !req.query.code) return fail('Sessão do login expirou, tente de novo');
  try {
    const user = await authService.loginGoogle(await google.exchange(req, String(req.query.code)));
    await setSession(req, res, user);
    res.redirect('/');
  } catch (err) {
    if (!err.status) console.error(err);
    fail(err.status ? err.message : 'Não foi possível entrar com o Google');
  }
});

// --- Preferências da conta (relatório por e-mail, horário do lembrete)
router.patch('/auth/prefs', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (b.weeklyEmail === undefined && b.reminderHour === undefined) throw new students.HttpError(400, 'Preferência inválida');
  if (b.weeklyEmail !== undefined) {
    if (typeof b.weeklyEmail !== 'boolean') throw new students.HttpError(400, 'Preferência inválida');
    await db.query('UPDATE users SET weekly_email=$1 WHERE id=$2', [b.weeklyEmail, req.user.id]);
  }
  if (b.reminderHour !== undefined) await push.setHour(req.user.id, b.reminderHour);
  res.json({ ok: true });
}));


// --- Lembrete por push
router.get('/push/key', (req, res) => res.json({ publicKey: push.enabled() ? config.push.publicKey : null }));
router.post('/push/subscribe', requireAuth, limiter(20), wrap(async (req, res) => {
  await push.subscribe(req.user.id, req.body || {});
  res.json({ ok: true });
}));
router.delete('/push/subscribe', requireAuth, wrap(async (req, res) => {
  await push.unsubscribe(req.user.id, req.body?.endpoint);
  res.json({ ok: true });
}));
router.post('/push/test', requireAuth, limiter(5), wrap(async (req, res) => {
  const sent = await push.sendToUser(req.user.id, { title: 'Lembretes ligados ✅', body: 'É assim que o Speak AI vai te chamar para estudar.', url: '/', tag: 'test' });
  res.json({ sent });
}));

// --- Relatório semanal por e-mail: descadastro pelo link do rodapé
// GET só mostra o botão (antivírus de e-mail abrem links sozinhos); o POST é que desliga
const unsubPage = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Speak AI</title>
  <body style="font-family:Arial,sans-serif;background:#0b0b14;color:#eee;display:grid;place-items:center;min-height:90vh;text-align:center;padding:16px">
  <div><h2>${title}</h2>${body}<p><a href="/" style="color:#b9a8ff">Abrir o Speak AI</a></p></div>`;
router.get('/email/unsubscribe', (req, res) => {
  if (!weeklyEmail.unsubscribe(req.query.t)) return res.status(400).type('html').send(unsubPage('Link inválido.', ''));
  res.type('html').send(unsubPage('Parar de receber o relatório semanal?', `<form method="post">
    <button style="background:#7c5cff;color:#fff;border:0;padding:12px 22px;border-radius:999px;font-weight:bold;font-size:15px;cursor:pointer">Sim, não quero mais receber</button></form>`));
});
router.post('/email/unsubscribe', limiter(20), wrap(async (req, res) => {
  const userId = weeklyEmail.unsubscribe(req.query.t);
  if (!userId) return res.status(400).type('html').send(unsubPage('Link inválido.', ''));
  await db.query('UPDATE users SET weekly_email=false WHERE id=$1', [userId]);
  res.type('html').send(unsubPage('Pronto, você não vai mais receber o relatório semanal.', '<p style="color:#aaa">Dá para ligar de novo na tela de Relatório do app.</p>'));
}));

// --- Administração
const A = [requireAuth, requireAdmin];
router.get('/admin/usage', ...A, wrap(async (req, res) => res.json(await usage.report(req.query.days))));
router.get('/admin/overview', ...A, wrap(async (req, res) => res.json(await admin.overview())));
router.get('/admin/users/:id', ...A, wrap(async (req, res) => res.json(await admin.user(id(req)))));
router.patch('/admin/users/:id', ...A, wrap(async (req, res) => res.json(await admin.update(req.user.id, id(req), req.body))));
router.post('/admin/users/:id/password', ...A, limiter(20), wrap(async (req, res) => {
  await admin.setPassword(id(req), req.body?.password);
  res.json({ ok: true });
}));
router.delete('/admin/users/:id', ...A, wrap(async (req, res) => {
  await admin.remove(req.user.id, id(req));
  res.json({ ok: true });
}));

// --- Catálogo
router.get('/meta', (req, res) => res.json({
  languages: LANGUAGES.map((l) => ({ slug: l.slug, code: l.code, name: l.name, namePt: l.namePt, flag: l.flag })),
  topics: TOPICS, goals: GOALS, levels: LEVELS.slice(0, 3), styles: students.STYLES,
  scenarios: SCENARIOS.map(({ id: sid, emoji, namePt, goalPt }) => ({ id: sid, emoji, namePt, goalPt })),
  turnOptions: conversations.TURN_OPTIONS,
  teachers: teachers.TEACHERS.map(teachers.publicTeacher),
}));

// --- Ambiente por idioma
const L = '/languages/:slug';
router.get(`${L}/dashboard`, requireAuth, wrap(async (req, res) => {
  const d = await students.getDashboard(req.user.id, req.params.slug);
  if (!d.enrolled) return res.json(d);
  const { student } = await students.getStudentLanguage(req.user.id, req.params.slug);
  const [goals, achievements] = await Promise.all([reports.goals(student.id, student), reports.achievements(student.id)]);
  res.json({ ...d, goals, achievements });
}));
router.post(`${L}/enroll`, requireAuth, wrap(async (req, res) => {
  const body = { ...(req.body || {}) };
  if (body.fromPlacement) {
    const result = await placement.latestResult(req.user.id, req.params.slug);
    if (result) { body.level = result.level; body.placement = result; }
  }
  await students.enroll(req.user.id, req.params.slug, body);
  res.status(201).json(await students.getDashboard(req.user.id, req.params.slug));
}));
router.patch(`${L}/profile`, requireAuth, wrap(async (req, res) => {
  await students.updateProfile(req.user.id, req.params.slug, req.body || {});
  res.json(await students.getDashboard(req.user.id, req.params.slug));
}));

// --- Nivelamento
router.post(`${L}/placement`, requireAuth, limiter(5), wrap(async (req, res) => {
  res.status(201).json(await placement.start(req.user.id, req.params.slug));
}));
router.post('/placement/:id/answer', requireAuth, limiter(30), wrap(async (req, res) => {
  res.json(await placement.answer(req.user.id, id(req), req.body?.answer));
}));

// --- Aulas estruturadas (lesson | daily | words) e material
router.post(`${L}/lessons`, requireAuth, limiter(10), wrap(async (req, res) => {
  res.status(201).json(await lessons.startLesson(req.user.id, req.params.slug, req.body || {}));
}));
router.get('/lessons/:id', requireAuth, wrap(async (req, res) => {
  res.json(await lessons.getLesson(req.user.id, id(req)));
}));
router.post('/lessons/:id/answer', requireAuth, limiter(30), wrap(async (req, res) => {
  res.json(await lessons.submitAnswer(req.user.id, id(req), req.body?.answer));
}));

// --- Conversa por voz ao vivo (a conversa em si passa pelo WebSocket em live.service)
router.get('/voice/remaining', requireAuth, wrap(async (req, res) => {
  const v = await usage.voiceRemaining(req.user.id);
  res.json({ limit: v.limit, usedSeconds: v.used, remainingSeconds: Number.isFinite(v.remaining) ? v.remaining : null });
}));
router.post(`${L}/live`, requireAuth, limiter(10), wrap(async (req, res) => {
  res.status(201).json(await live.start(req.user.id, req.params.slug, req.body || {}));
}));

// --- Conversa livre e roleplay (texto)
router.post(`${L}/conversations`, requireAuth, limiter(10), wrap(async (req, res) => {
  res.status(201).json(await conversations.start(req.user.id, req.params.slug, req.body || {}));
}));
router.post('/conversations/:id/message', requireAuth, limiter(30), wrap(async (req, res) => {
  res.json(await conversations.reply(req.user.id, id(req), req.body?.text));
}));
router.post('/conversations/:id/finish', requireAuth, limiter(10), wrap(async (req, res) => {
  res.json(await conversations.finish(req.user.id, id(req)));
}));

// --- Vocabulário
router.get(`${L}/vocabulary`, requireAuth, wrap(async (req, res) => {
  res.json(await vocabulary.list(req.user.id, req.params.slug, { filter: req.query.filter, q: req.query.q }));
}));
router.post(`${L}/vocabulary`, requireAuth, limiter(30), wrap(async (req, res) => {
  const { word, translation, pronunciation, meaning } = req.body || {};
  res.status(201).json(await vocabulary.add(req.user.id, req.params.slug, word, { translation, pronunciation, meaning }));
}));
router.patch(`${L}/vocabulary/:id`, requireAuth, wrap(async (req, res) => {
  res.json(await vocabulary.update(req.user.id, req.params.slug, id(req), req.body || {}));
}));
router.delete(`${L}/vocabulary/:id`, requireAuth, wrap(async (req, res) => {
  res.json(await vocabulary.remove(req.user.id, req.params.slug, id(req)));
}));
router.get(`${L}/vocabulary/review`, requireAuth, wrap(async (req, res) => {
  res.json(await vocabulary.reviewQueue(req.user.id, req.params.slug));
}));
router.post(`${L}/vocabulary/:id/review`, requireAuth, limiter(120), wrap(async (req, res) => {
  res.json(await vocabulary.review(req.user.id, req.params.slug, id(req), req.body?.success));
}));

// --- Pronúncia, listening e áudio
router.get(`${L}/pronunciation`, requireAuth, wrap(async (req, res) => {
  res.json(await pronunciation.overview(req.user.id, req.params.slug));
}));
router.post(`${L}/pronunciation/assess`, requireAuth, limiter(20), upload.single('audio'), wrap(async (req, res) => {
  res.json(await pronunciation.assess(req.user.id, req.params.slug, { file: req.file, text: req.body?.text, module: req.body?.module }));
}));
router.post(`${L}/listening/check`, requireAuth, limiter(60), wrap(async (req, res) => {
  res.json(await pronunciation.checkListening(req.user.id, req.params.slug, req.body || {}));
}));
router.get(`${L}/tts`, requireAuth, limiter(60), wrap(async (req, res) => {
  const lang = students.resolveLanguage(req.params.slug);
  const text = String(req.query.text || '').trim();
  if (!text || text.length > 400) throw new students.HttpError(400, 'Texto inválido');
  // voz: a pedida (prévia do professor) ou a do professor escolhido pelo aluno
  let voice = teachers.TEACHERS.some((t) => t.voice === req.query.voice) ? req.query.voice : null;
  if (!voice) {
    const { student } = await students.getStudentLanguage(req.user.id, req.params.slug);
    voice = teachers.getTeacher(student?.teacher_voice, lang.code).voice;
  }
  let file;
  try { file = await tts.speak({ text, lang, voice, slow: req.query.slow === '1' }); } catch { throw new students.HttpError(503, 'Áudio indisponível'); }
  res.set('Cache-Control', 'private, max-age=604800');
  res.sendFile(file);
}));

// --- Material (foto / PDF)
router.get(`${L}/materials`, requireAuth, wrap(async (req, res) => {
  res.json(await materials.list(req.user.id, req.params.slug));
}));
router.post(`${L}/materials`, requireAuth, limiter(10, 10 * 60000), upload.single('file'), wrap(async (req, res) => {
  res.status(201).json(await materials.upload(req.user.id, req.params.slug, req.file));
}));
router.get(`${L}/materials/:id`, requireAuth, wrap(async (req, res) => {
  res.json(await materials.get(req.user.id, req.params.slug, id(req)));
}));
router.delete(`${L}/materials/:id`, requireAuth, wrap(async (req, res) => {
  res.json(await materials.remove(req.user.id, req.params.slug, id(req)));
}));
router.post(`${L}/materials/:id/lesson`, requireAuth, limiter(10), wrap(async (req, res) => {
  res.status(201).json(await lessons.startMaterialLesson(req.user.id, req.params.slug, id(req)));
}));

// --- Chat livre com o professor
router.get(`${L}/tutor`, requireAuth, wrap(async (req, res) => {
  res.json(await tutor.thread(req.user.id, req.params.slug));
}));
router.post(`${L}/tutor/new`, requireAuth, wrap(async (req, res) => {
  res.status(201).json(await tutor.reset(req.user.id, req.params.slug));
}));
router.post('/tutor/:id/message', requireAuth, limiter(20), upload.single('image'), wrap(async (req, res) => {
  res.json(await tutor.send(req.user.id, id(req), { text: req.body?.text, file: req.file }));
}));
router.get('/tutor/:id/image/:msg', requireAuth, wrap(async (req, res) => {
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(await tutor.imageFile(req.user.id, id(req), id(req, 'msg')));
}));

// --- Relatório semanal
router.get(`${L}/report`, requireAuth, wrap(async (req, res) => {
  res.json(await reports.weekly(req.user.id, req.params.slug));
}));

// Erros de upload (tamanho/limite) viram 400 amigável
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo maior que 10 MB' : 'Upload inválido' });
  next(err);
});

module.exports = router;
