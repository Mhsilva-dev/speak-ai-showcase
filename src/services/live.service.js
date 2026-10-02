// Aula de conversação por voz em tempo real (Gemini Live).
// Navegador ⇄ (WebSocket) ⇄ este servidor ⇄ (WebSocket) ⇄ Gemini Live. A chave nunca vai para o navegador.
const WebSocket = require('ws');
const config = require('../config');
const db = require('../db/pool');
const { TOPICS } = require('../languages');
const SCENARIOS = require('../languages/scenarios');
const prompts = require('./ai/prompts');
const teacher = require('./ai/teacher.service');
const engine = require('./pedagogy/engine');
const { S, walk } = require('./pedagogy/stateMachine');
const progress = require('./progress.service');
const students = require('./student.service');
const lessons = require('./lesson.service');
const auth = require('./auth.service');
const { COOKIE } = require('../middleware/auth');
const { getTeacher } = require('../languages/teachers');
const usage = require('./usage.service');

const { HttpError } = students;
const GEMINI_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const activeByUser = new Map();

function log(msg, extra = {}) {
  if (config.env !== 'test') console.log(JSON.stringify({ at: new Date().toISOString(), svc: 'live', msg, ...extra }));
}

async function start(userId, slug, { topic, scenario: scenarioId } = {}) {
  const { student } = await students.requireStudentLanguage(userId, slug);
  const { limit, remaining } = await usage.voiceRemaining(userId);
  if (remaining < 30) throw new HttpError(429, `Seu tempo de conversa por voz de hoje acabou (${limit} min por dia). Volte amanhã ou continue pelo chat e pelas aulas escritas.`);
  const active = await lessons.activeLessonId(student.id, ['live']);
  if (active) return lessons.getLesson(userId, active);

  let scenario = null;
  if (scenarioId) {
    scenario = scenarioId === 'surprise' ? SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)] : SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) throw new HttpError(400, 'Cenário inválido');
  }
  if (!scenario) {
    if (!topic || topic === 'surprise') topic = engine.pickTopic({ goal: student.goal, interests: student.interests, recentTopics: await students.recentTopics(student.id) });
    if (!TOPICS.includes(topic)) throw new HttpError(400, 'Tema inválido');
  }
  const { state } = walk(S.LESSON_STARTED, S.INTRODUCTION, S.PRACTICE, S.WAITING_FOR_ANSWER);
  const { rows: [l] } = await db.query(
    `INSERT INTO lessons(student_language_id, topic, state, mode, scenario, target_turns, difficulty)
     VALUES ($1,$2,$3,'live',$4,NULL,2) RETURNING id`, [student.id, scenario ? scenario.namePt : topic, state, scenario?.id || null]);
  return lessons.getLesson(userId, l.id);
}

const CORRECTION_TOOL = {
  functionDeclarations: [{
    name: 'show_correction',
    description: 'Mostra um cartão de correção na tela do aluno. Use sempre que corrigir um erro de gramática ou vocabulário, chamando LOGO NO INÍCIO da resposta (antes de falar a correção); depois continue falando normalmente.',
    behavior: 'NON_BLOCKING',
    parameters: {
      type: 'OBJECT',
      properties: {
        original: { type: 'STRING', description: 'O trecho exato que o aluno falou errado' },
        corrected: { type: 'STRING', description: 'A frase corrigida' },
        explanation_pt: { type: 'STRING', description: 'Explicação curtíssima em português' },
        error_type: { type: 'STRING', description: 'Código do tipo de erro' },
        severity: { type: 'STRING', enum: ['critical', 'relevant', 'minor'] },
      },
      required: ['original', 'corrected', 'explanation_pt'],
    },
  }, {
    name: 'show_phrase',
    description: 'Mostra na tela do aluno um cartão de pronúncia (modo fonético) com uma frase para ele ler e repetir. Use quando o aluno pedir ajuda, perguntar como se diz algo ou não conseguir falar uma frase. Chame LOGO NO INÍCIO da resposta, antes de começar a falar a frase.',
    behavior: 'NON_BLOCKING',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'A frase no idioma estudado' },
        translation: { type: 'STRING', description: 'Tradução em português' },
        ipa: { type: 'STRING', description: 'Transcrição IPA' },
        br: { type: 'STRING', description: 'Pronúncia aproximada como um brasileiro leria, sílaba tônica em MAIÚSCULAS' },
        tip: { type: 'STRING', description: 'Dica curta de pronúncia em português' },
      },
      required: ['text', 'translation', 'br'],
    },
  }],
};

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

/** Uma sessão ao vivo: liga o navegador a uma conexão com o Gemini e grava a conversa */
class LiveSession {
  constructor(client, ctx) {
    Object.assign(this, ctx);
    this.client = client;
    this.upstream = null;
    this.buf = { student: '', teacher: '' };
    this.turn = 0; // fala do professor atual (para a tradução por partes)
    this.tr = { done: 0, seq: 0, timer: null };
    this.closed = false;
    this.startedAt = Date.now();
    this.queue = Promise.resolve();
    this.usage = { id: null, model: null, totals: { inText: 0, inAudio: 0, outText: 0, outAudio: 0 }, from: null, seconds: 0, timer: null };
  }

  /** Tempo de voz desta sessão: conta desde que o professor ficou pronto (reconexões somam) */
  liveSeconds() {
    return this.usage.seconds + (this.usage.from ? (Date.now() - this.usage.from) / 1000 : 0);
  }

  saveUsage() {
    const seconds = this.liveSeconds();
    // Sem contagem de tokens do Gemini: estima pelo tempo (~25 tokens de áudio por segundo, professor fala ~metade)
    const totals = this.usage.reported ? this.usage.totals
      : { inText: 0, inAudio: Math.round(seconds * 25), outText: 0, outAudio: Math.round(seconds * 12.5) };
    return usage.updateLive(this.usage.id, { model: this.usage.model, totals, seconds });
  }

  /** Acabou o tempo (da sessão ou do dia)? */
  overLimit() {
    if (Date.now() - this.startedAt > config.ai.liveMaxMinutes * 60000) return `Limite de ${config.ai.liveMaxMinutes} minutos por conversa atingido.`;
    if (this.liveSeconds() >= this.remainingSeconds) return `Seu tempo de voz de hoje acabou (${this.voiceLimit} min por dia). Volte amanhã ou continue pelo chat.`;
    return null;
  }

  send(obj) {
    if (this.client.readyState === WebSocket.OPEN) this.client.send(JSON.stringify(obj));
  }

  // Grava em ordem (as mensagens chegam em rajadas)
  enqueue(fn) {
    this.queue = this.queue.then(fn).catch((e) => log('erro ao gravar', { error: e.message }));
    return this.queue;
  }

  async connect(modelIndex = 0) {
    const model = config.ai.liveModels[modelIndex];
    if (!model) { this.send({ type: 'error', error: 'O professor ao vivo está indisponível agora. Tente de novo em instantes.' }); return this.close(); }
    const { rows: history } = await db.query(
      `SELECT role, content FROM (SELECT id, role, content FROM messages WHERE lesson_id=$1 AND kind IN ('reply','answer') ORDER BY id DESC LIMIT 12) t ORDER BY id`, [this.lessonId]);
    this.resumed = history.length > 0;
    const up = new WebSocket(`${GEMINI_WS}?key=${encodeURIComponent(config.ai.geminiApiKey)}`);
    this.upstream = up;
    let ready = false;
    up.on('open', () => up.send(JSON.stringify({
      setup: {
        model: `models/${model}`,
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: getTeacher(this.student.teacher_voice, this.lang.code).voice } } } },
        systemInstruction: { parts: [{ text: prompts.liveSystem({ ...this, history }) }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} },
        tools: [CORRECTION_TOOL],
      },
    })));
    up.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.setupComplete) {
        ready = true;
        log('conectado', { lesson: this.lessonId, model });
        this.usage.model = model;
        this.usage.from = Date.now();
        if (!this.usage.id) {
          usage.record({ userId: this.userId, kind: 'live', task: 'live', model }).then((id) => { this.usage.id = id; });
          this.usage.timer = setInterval(() => this.checkTime(), 15000);
        }
        this.send({ type: 'ready', resumed: this.resumed,
          remainingSeconds: Number.isFinite(this.remainingSeconds) ? Math.max(0, Math.round(this.remainingSeconds - this.liveSeconds())) : null });
        // O professor abre a aula (ou retoma)
        up.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: this.resumed ? '(A conexão caiu e voltou. Diga em português que a conexão voltou e retome a conversa de onde parou.)' : `(A aula começou agora. Siga esta ordem: 1) cumprimente o aluno pelo nome em ${this.lang.name} (curto e simpático); 2) em PORTUGUÊS, apresente-se e explique em 1 ou 2 frases o que vão praticar hoje e que você vai explicar em português e conversar em ${this.lang.name}; ${this.memories?.sessions?.length && !this.scenario ? 'antes da pergunta, lembre em português algo da última conversa ou um fato que ele contou (ex.: "Da última vez você me contou que..."); ' : ''}3) faça a primeira pergunta em ${this.lang.name}${['A1', 'A2'].includes(this.student.level) ? ' e diga em português como ele pode responder' : ''}.)` }] }], turnComplete: true } }));
        return;
      }
      this.onUpstream(m);
    });
    up.on('close', (code, reason) => {
      if (this.closed) return;
      if (!ready) { log('falha ao conectar', { model, code, reason: String(reason).slice(0, 120) }); return this.connect(modelIndex + 1); }
      log('upstream fechou', { code, reason: String(reason).slice(0, 120) });
      if (this.usage.from) { this.usage.seconds += (Date.now() - this.usage.from) / 1000; this.usage.from = null; }
      this.flush('student'); this.flush('teacher');
      this.send({ type: 'reconnect' });
      this.close();
    });
    up.on('error', (e) => log('erro upstream', { error: e.message }));
  }

  /** A cada 15 s: grava o uso e encerra se o tempo acabou (mesmo com o aluno calado) */
  checkTime() {
    this.saveUsage();
    const over = this.overLimit();
    if (over) { this.send({ type: 'limit', text: over }); this.close(); }
  }

  onUpstream(m) {
    if (m.usageMetadata) { this.usage.totals = this.addUsage(m.usageMetadata); this.usage.reported = true; }
    const sc = m.serverContent;
    if (sc) {
      if (sc.inputTranscription?.text) {
        if (this.buf.teacher) this.flush('teacher', { interrupted: true });
        this.buf.student += sc.inputTranscription.text;
        this.send({ type: 'partial', role: 'student', text: this.buf.student });
      }
      if (sc.outputTranscription?.text) {
        if (this.buf.student) this.flush('student');
        if (!this.buf.teacher) { this.turn++; this.tr = { done: 0, seq: 0, timer: null }; }
        this.buf.teacher += sc.outputTranscription.text;
        this.send({ type: 'partial', role: 'teacher', text: this.buf.teacher, turn: this.turn });
        // Traduz cada frase assim que ela termina, sem esperar o professor acabar de falar
        clearTimeout(this.tr.timer);
        this.tr.timer = setTimeout(() => this.translateReady(), 500);
      }
      for (const p of sc.modelTurn?.parts || []) {
        if (p.inlineData?.data) {
          if (this.buf.student) this.flush('student');
          this.send({ type: 'audio', data: p.inlineData.data });
        }
      }
      if (sc.interrupted) { this.flush('teacher', { interrupted: true }); this.send({ type: 'interrupted' }); }
      if (sc.turnComplete) { this.flush('teacher'); this.send({ type: 'turnComplete' }); }
    }
    if (m.toolCall) this.onToolCall(m.toolCall);
    if (m.goAway) this.send({ type: 'notice', text: 'A sessão vai ser renovada em instantes…' });
  }

  addUsage(meta) {
    const t = usage.tokens(meta);
    const a = this.usage.totals;
    return { inText: a.inText + t.inText, inAudio: a.inAudio + t.inAudio, outText: a.outText + t.outText, outAudio: a.outAudio + t.outAudio };
  }

  flush(role, extra = {}) {
    if (role === 'teacher') {
      clearTimeout(this.tr.timer);
      this.translatePart(this.buf.teacher.slice(this.tr.done)); // o que sobrou sem tradução
      this.tr.done = this.buf.teacher.length;
    }
    const text = this.buf[role].replace(/\s+/g, ' ').trim();
    this.buf[role] = '';
    if (!text) return;
    this.enqueue(async () => {
      const kind = role === 'student' ? 'answer' : 'reply';
      const { rows: [msg] } = await db.query(
        `INSERT INTO messages(lesson_id, role, kind, content, payload) VALUES ($1,$2,$3,$4,$5) RETURNING id, role, kind, content, payload, created_at`,
        [this.lessonId, role, kind, text.slice(0, 2000), Object.keys(extra).length ? extra : null]);
      if (role === 'student') {
        await db.tx(async (c) => {
          await c.query('UPDATE lessons SET turns = turns + 1 WHERE id=$1', [this.lessonId]);
          await progress.addXp(c, this.slId, config.pedagogy.xp.conversationTurn, 'live_turn');
        });
      }
      this.send({ type: 'message', message: msg });
    });
  }

  /** Traduz as frases já completas da fala em andamento */
  translateReady() {
    const pending = this.buf.teacher.slice(this.tr.done);
    let cut = -1;
    const re = /[.!?…:](?=\s|$)/g;
    for (let m; (m = re.exec(pending));) cut = m.index + 1;
    if (cut < 12) return; // ainda não tem frase inteira
    this.tr.done += cut;
    this.translatePart(pending.slice(0, cut));
  }

  /** Tradução de um pedaço da fala do professor (não bloqueia a conversa) */
  translatePart(raw) {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) return;
    const turn = this.turn;
    const seq = this.tr.seq++;
    usage.context.run({ userId: this.userId }, () => teacher.translateLine({ lang: this.lang, student: this.student, text }))
      .then(({ pt }) => { if (pt) this.send({ type: 'translation', turn, seq, text: pt }); })
      .catch(() => { /* sem tradução neste trecho */ });
  }

  /** Mostra o cartão na tela na hora e grava em seguida */
  showNow(kind, content, payload, after) {
    this.send({ type: 'message', message: { id: null, role: 'teacher', kind, content, payload, created_at: new Date().toISOString() } });
    this.enqueue(async () => {
      await db.query(`INSERT INTO messages(lesson_id, role, kind, content, payload) VALUES ($1,'teacher',$2,$3,$4)`, [this.lessonId, kind, content, payload]);
      if (after) await after();
    });
  }

  onToolCall(toolCall) {
    const calls = toolCall.functionCalls || [];
    if (this.upstream?.readyState === WebSocket.OPEN) {
      this.upstream.send(JSON.stringify({ toolResponse: { functionResponses: calls.map((f) => ({ id: f.id, name: f.name, response: { ok: true, scheduling: 'SILENT' } })) } }));
    }
    for (const f of calls.filter((x) => x.name === 'show_phrase')) {
      const a = f.args || {};
      if (!a.text) continue;
      if (this.buf.student) this.flush('student');
      const phrase = ['text', 'translation', 'ipa', 'br', 'tip'].reduce((o, k) => ({ ...o, [k]: a[k] ? String(a[k]).slice(0, 400) : null }), {});
      this.showNow('phrase', phrase.text, { phrases: [phrase] });
    }
    for (const f of calls.filter((x) => x.name === 'show_correction')) {
      const a = f.args || {};
      if (!a.original || !a.corrected) continue;
      if (this.buf.student) this.flush('student');
      const error = {
        type: String(a.error_type || 'GRAMMAR').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 60),
        original: String(a.original).slice(0, 200),
        corrected: String(a.corrected).slice(0, 200),
        severity: ['critical', 'relevant', 'minor'].includes(a.severity) ? a.severity : 'relevant',
      };
      const payload = { stage: 'LIVE', errors: [error], original: error.original, corrected: error.corrected, explanationPt: String(a.explanation_pt || '').slice(0, 400), askRepeat: false };
      this.showNow('correction', '', payload,
        () => db.tx((c) => progress.recordErrors(c, this.slId, null, [error], this.skillByCode, { source: 'live', lessonId: this.lessonId })));
    }
  }

  fromClient(raw) {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    const up = this.upstream;
    if (!up || up.readyState !== WebSocket.OPEN) return;
    const over = this.overLimit();
    if (over) { this.send({ type: 'limit', text: over }); return this.close(); }
    if (m.type === 'audio' && typeof m.data === 'string' && m.data.length < 200000) {
      up.send(JSON.stringify({ realtimeInput: { audio: { data: m.data, mimeType: 'audio/pcm;rate=16000' } } }));
    } else if (m.type === 'audioEnd') {
      up.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    } else if (m.type === 'text' && typeof m.text === 'string' && m.text.trim()) {
      const text = m.text.trim().slice(0, 1000);
      this.buf.student = text; this.flush('student');
      up.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }));
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.flush('student'); this.flush('teacher');
    clearInterval(this.usage.timer);
    if (this.usage.from) { this.usage.seconds += (Date.now() - this.usage.from) / 1000; this.usage.from = null; }
    // a linha de uso pode ainda estar sendo criada: grava depois que existir
    const save = () => (this.usage.id ? this.saveUsage() : setTimeout(() => this.saveUsage(), 2000));
    save();
    try { this.upstream?.close(); } catch { /* já fechado */ }
    try { this.client.close(); } catch { /* já fechado */ }
    if (activeByUser.get(this.userId) === this) activeByUser.delete(this.userId);
  }
}

/** Liga o endpoint /api/live/:id no servidor HTTP */
function attach(server) {
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 512 * 1024 });
  server.on('upgrade', async (req, socket, head) => {
    const match = req.url.match(/^\/api\/live\/(\d+)(\?|$)/);
    if (!match) return socket.destroy();
    try {
      // Só aceita conexão vinda do próprio site (impede outro site de abrir a voz com o cookie do aluno)
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new Error('origin');
      const session = auth.verify(parseCookies(req.headers.cookie)[COOKIE]);
      if (!session || !(await auth.getUser(session.id, session.sv))) throw new Error('auth');
      const userId = session.id;
      const lesson = await lessons.loadLessonFor(userId, Number(match[1]));
      if (lesson.mode !== 'live' || lesson.state === S.LESSON_COMPLETED) throw new Error('lesson');
      const { lang, student } = await students.requireStudentLanguage(userId, lesson.slug);
      const [skills, errors, { rows: [user] }] = await Promise.all([
        students.loadSkills(student.id), students.loadOpenErrors(student.id), db.query('SELECT name FROM users WHERE id=$1', [userId]),
      ]);
      const ctx = {
        userId, lessonId: lesson.id, slId: student.id, lang, student: { ...student, name: user.name },
        topic: lesson.topic, scenario: SCENARIOS.find((s) => s.id === lesson.scenario) || null,
        weaknesses: errors.slice(0, 4).map((e) => `${e.error_type}: "${e.actual}" → "${e.expected}"`),
        skillCodes: skills.map((s) => s.code),
        skillByCode: Object.fromEntries(skills.map((s) => [s.code, s.id])),
        memories: await progress.loadMemories(student.id, db),
      };
      const voice = await usage.voiceRemaining(userId);
      if (voice.remaining < 30) throw new Error('limit');
      ctx.remainingSeconds = voice.remaining;
      ctx.voiceLimit = voice.limit;
      wss.handleUpgrade(req, socket, head, (ws) => {
        // Uma conversa por voz por pessoa: a antiga (outra aba/aparelho) é avisada e para de vez, sem reconectar
        const old = activeByUser.get(userId);
        if (old) { old.send({ type: 'replaced' }); old.close(); }
        const session = new LiveSession(ws, ctx);
        activeByUser.set(userId, session);
        ws.on('message', (raw) => session.fromClient(raw));
        ws.on('close', () => session.close());
        session.connect().catch((e) => { log('erro', { error: e.message }); session.close(); });
      });
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });
}

/** Para o painel de admin: quem está numa conversa por voz agora, e encerrar a de alguém */
const activeUserIds = () => [...activeByUser.keys()];
const endFor = (userId) => activeByUser.get(userId)?.close();

/** Desligando o servidor (deploy): avisa os alunos e grava o tempo de voz de quem estava em conversa */
async function closeAll() {
  const sessions = [...activeByUser.values()];
  for (const s of sessions) { s.send({ type: 'reconnect' }); s.close(); }
  await Promise.all(sessions.map((s) => s.usage.id && s.saveUsage()));
}

module.exports = { start, attach, activeUserIds, endFor, closeAll };
