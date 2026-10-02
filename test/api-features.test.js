// Fluxos das novas funções contra o banco de teste, com IA simulada.
process.env.NODE_ENV = 'test';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const app = require('../src/app');

const agent = request.agent(app);
const E = '/api/languages/english';

before(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  await agent.post('/api/auth/register').send({ name: 'Leo', email: 'leo@ex.com', password: 'senha1234' }).expect(201);
});
after(() => db.pool.end());

async function finishActive(lessonId, answers) {
  let r;
  for (const a of answers) r = await agent.post(`/api/lessons/${lessonId}/answer`).send({ answer: a }).expect(200);
  return r.body;
}

describe('nivelamento', () => {
  test('teste completo antes de configurar o idioma e matrícula com o resultado', async () => {
    let t = (await agent.post(`${E}/placement`).expect(201)).body;
    assert.equal(t.total, 6);
    assert.ok(t.question.prompt.startsWith('A2'));
    // retomar devolve o mesmo teste
    assert.equal((await agent.post(`${E}/placement`).expect(201)).body.id, t.id);
    for (const a of ['pass', 'pass', 'nope', 'meh', 'pass', 'nope']) t = (await agent.post(`/api/placement/${t.id}/answer`).send({ answer: a }).expect(200)).body;
    assert.equal(t.completed, true);
    assert.ok(['A1', 'A2', 'B1'].includes(t.result.level));
    const d = (await agent.post(`${E}/enroll`).send({ fromPlacement: true, goal: 'viagem', teachingStyle: 'balanced' }).expect(201)).body;
    assert.equal(d.level, t.result.level);
    assert.equal(d.placement.level, t.result.level);
  });
});

describe('vocabulário e flashcards', () => {
  let wordId;
  test('adiciona (com enriquecimento), lista, marca difícil', async () => {
    const w = (await agent.post(`${E}/vocabulary`).send({ word: '  Although ' }).expect(201)).body;
    assert.equal(w.word, 'although');
    assert.equal(w.translation, 'tradução');
    wordId = w.id;
    await agent.post(`${E}/vocabulary`).send({ word: 'through' }).expect(201);
    const l = (await agent.get(`${E}/vocabulary`).expect(200)).body;
    assert.equal(l.counts.total, 2);
    assert.equal(l.counts.due, 2);
    const d = (await agent.patch(`${E}/vocabulary/${wordId}`).send({ difficult: true }).expect(200)).body;
    assert.equal(d.difficult, true);
    assert.equal((await agent.get(`${E}/vocabulary?filter=difficult`).expect(200)).body.words.length, 1);
  });
  test('revisão: acerto empurra para 1 dia e soma XP', async () => {
    const q = (await agent.get(`${E}/vocabulary/review`).expect(200)).body;
    assert.equal(q.cards[0].id, wordId, 'difícil primeiro');
    const r = (await agent.post(`${E}/vocabulary/${wordId}/review`).send({ success: true }).expect(200)).body;
    assert.equal(r.word.srs_interval_days, 1);
    assert.ok(new Date(r.word.next_review) > new Date());
    const r2 = (await agent.post(`${E}/vocabulary/${wordId}/review`).send({ success: false }).expect(200)).body;
    assert.equal(r2.word.mistakes, 1);
  });
  test('remove', async () => {
    const l = (await agent.get(`${E}/vocabulary`).expect(200)).body;
    const other = l.words.find((w) => w.word === 'through');
    await agent.delete(`${E}/vocabulary/${other.id}`).expect(200);
    await agent.delete(`${E}/vocabulary/${other.id}`).expect(404);
  });
});

describe('aula do dia e palavras escolhidas', () => {
  test('aula do dia inclui palavra vencida e atualiza o SRS dela', async () => {
    await db.query(`UPDATE vocabulary SET next_review = now() - interval '1 hour', srs_interval_days = 1`);
    const lesson = (await agent.post(`${E}/lessons`).send({ mode: 'daily' }).expect(201)).body;
    assert.equal(lesson.mode, 'daily');
    const { rows: items } = await db.query('SELECT vocab_id FROM lesson_items WHERE lesson_id=$1 ORDER BY order_index', [lesson.id]);
    assert.ok(items[0].vocab_id, 'primeiro item revisa a palavra');
    const done = await finishActive(lesson.id, items.map((_, i) => `answer ${i + 1}`));
    assert.equal(done.state, 'LESSON_COMPLETED');
    const { rows: [v] } = await db.query('SELECT srs_interval_days FROM vocabulary WHERE id=$1', [items[0].vocab_id]);
    assert.equal(v.srs_interval_days, 3);
    const d = (await agent.get(`${E}/dashboard`).expect(200)).body;
    assert.equal(d.goals.dailyLessonDone, true);
    assert.ok(d.achievements.find((a) => a.code === 'FIRST_LESSON').unlockedAt);
    assert.equal(done.messages.filter((m) => m.kind === 'achievement').length >= 1, true);
  });
  test('praticar palavras escolhidas', async () => {
    const { words } = (await agent.get(`${E}/vocabulary`).expect(200)).body;
    const lesson = (await agent.post(`${E}/lessons`).send({ mode: 'words', wordIds: words.map((w) => w.id) }).expect(201)).body;
    assert.equal(lesson.mode, 'words');
    assert.equal(lesson.items.length, words.length);
    await finishActive(lesson.id, words.map((_, i) => `answer ${i + 1}`));
  });
});

describe('conversa livre', () => {
  let c;
  test('começa, corrige pedindo nova tentativa e segue a conversa', async () => {
    c = (await agent.post(`${E}/conversations`).send({ mode: 'conversation', topic: 'filmes', turns: 6 }).expect(201)).body;
    assert.equal(c.mode, 'conversation');
    assert.deepEqual(c.messages.map((m) => m.kind), ['context', 'reply']);

    let r = (await agent.post(`/api/conversations/${c.id}/message`).send({ text: 'She are wrong' }).expect(200)).body;
    assert.equal(r.messages.at(-1).kind, 'correction');
    assert.equal(r.turns, 0, 'turno não avança antes de corrigir');
    r = (await agent.post(`/api/conversations/${c.id}/message`).send({ text: 'She is wrong again' }).expect(200)).body;
    assert.equal(r.messages.at(-2).payload.stage, 'GIVE_UP', 'balanced: 1 nova tentativa, depois mostra a forma correta');
    assert.equal(r.messages.at(-1).kind, 'reply');
    assert.equal(r.turns, 1);

    r = (await agent.post(`/api/conversations/${c.id}/message`).send({ text: 'I like it relevant' }).expect(200)).body;
    assert.equal(r.messages.at(-2).kind, 'note', 'erro relevante numa frase compreensível vira anotação, sem travar');
    r = (await agent.post(`/api/conversations/${c.id}/message`).send({ text: 'OFFTOPIC' }).expect(200)).body;
    assert.equal(r.messages.at(-1).kind, 'redirect');
    assert.equal(r.turns, 2);
  });
  test('não abre outra conversa com uma em andamento (retoma a mesma)', async () => {
    const again = (await agent.post(`${E}/conversations`).send({ mode: 'conversation', topic: 'música' }).expect(201)).body;
    assert.equal(again.id, c.id);
  });
  test('erro da conversa fica marcado com a origem', async () => {
    const { rows } = await db.query(`SELECT source, source_lesson_id FROM student_errors WHERE error_type='VERB_TO_BE'`);
    assert.equal(rows[0].source, 'conversation');
    assert.equal(rows[0].source_lesson_id, c.id);
  });
  test('encerrar antes do fim gera relatório', async () => {
    const r = (await agent.post(`/api/conversations/${c.id}/finish`).expect(200)).body;
    assert.equal(r.completed, true);
    assert.equal(r.summary.scores.grammar, 70);
    assert.equal(r.messages.at(-1).kind, 'summary');
    await agent.post(`/api/conversations/${c.id}/message`).send({ text: 'hi' }).expect(409);
  });
  test('o professor guarda memória da conversa para as próximas aulas', async () => {
    const { rows } = await db.query(`SELECT kind, content FROM student_memories ORDER BY id`);
    assert.deepEqual(rows.map((r) => r.kind), ['fact', 'session']);
    assert.equal(rows[0].content, 'Trabalha como programador');
    const { loadMemories } = require('../src/services/progress.service');
    const m = await loadMemories((await db.query('SELECT id FROM student_languages LIMIT 1')).rows[0].id, db);
    assert.equal(m.facts[0], 'Trabalha como programador');
    assert.match(m.sessions[0], /Conversaram sobre filmes/);
  });
  test('a aula do dia começa pelo erro da conversa', async () => {
    const d = (await agent.get(`${E}/dashboard`).expect(200)).body;
    assert.equal(d.dailyReview[0].source, 'conversation');
  });
});

describe('roleplay', () => {
  test('cena termina quando o objetivo é cumprido (após 3 turnos)', async () => {
    const c = (await agent.post(`${E}/conversations`).send({ mode: 'roleplay', scenario: 'hotel' }).expect(201)).body;
    assert.equal(c.scenario.id, 'hotel');
    assert.equal(c.messages[1].content, 'Welcome to our hotel!');
    let r;
    for (const t of ['hello done', 'ok', 'thanks done']) r = (await agent.post(`/api/conversations/${c.id}/message`).send({ text: t }).expect(200)).body;
    assert.equal(r.completed, true);
    assert.equal(r.turns, 3);
    const d = (await agent.get(`${E}/dashboard`).expect(200)).body;
    assert.ok(d.achievements.find((a) => a.code === 'FIRST_ROLEPLAY').unlockedAt);
  });
  test('cenário inválido', async () => {
    await agent.post(`${E}/conversations`).send({ mode: 'roleplay', scenario: 'mars' }).expect(400);
  });
  test('encerrar sem falar nada descarta', async () => {
    const c = (await agent.post(`${E}/conversations`).send({ mode: 'conversation', topic: 'filmes' }).expect(201)).body;
    const r = (await agent.post(`/api/conversations/${c.id}/finish`).expect(200)).body;
    assert.equal(r.discarded, true);
    await agent.get(`/api/lessons/${c.id}`).expect(404);
  });
});

describe('material (foto/PDF)', () => {
  test('rejeita arquivo que não é imagem/PDF', async () => {
    await agent.post(`${E}/materials`).attach('file', Buffer.from('<html>oi</html>'), 'x.png').expect(400);
  });
  test('analisa, esconde as respostas e vira aula', async () => {
    const pdf = Buffer.from('%PDF-1.4\n' + 'x'.repeat(100));
    const m = (await agent.post(`${E}/materials`).attach('file', pdf, 'apostila.pdf').expect(201)).body;
    assert.equal(m.exercises.length, 2);
    assert.equal(m.exercises[0].answer, undefined, 'resposta não vai para o navegador');
    const lesson = (await agent.post(`${E}/materials/${m.id}/lesson`).expect(201)).body;
    assert.equal(lesson.mode, 'material');
    let r = (await agent.post(`/api/lessons/${lesson.id}/answer`).send({ answer: 'went' }).expect(200)).body;
    assert.equal(r.items[0].status, 'correct');
    r = (await agent.post(`/api/lessons/${lesson.id}/answer`).send({ answer: 'ate' }).expect(200)).body;
    assert.equal(r.completed, true);
    await agent.delete(`${E}/materials/${m.id}`).expect(200);
  });
});

describe('pronúncia e listening', () => {
  test('catálogo de sons e frases de ditado', async () => {
    const p = (await agent.get(`${E}/pronunciation`).expect(200)).body;
    assert.ok(p.modules.find((m) => m.code === 'TH_VOICELESS'));
    assert.ok(p.listening.sentences.length >= 5);
  });
  test('ditado corrigido localmente', async () => {
    const { listening } = (await agent.get(`${E}/pronunciation`).expect(200)).body;
    const text = listening.sentences[0];
    const r = (await agent.post(`${E}/listening/check`).send({ text, typed: text.toLowerCase() }).expect(200)).body;
    assert.equal(r.score, 100);
    await agent.post(`${E}/listening/check`).send({ text: 'inventada', typed: 'x' }).expect(400);
  });
  test('shadowing: avalia o áudio enviado', async () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(5000)]);
    const r = (await agent.post(`${E}/pronunciation/assess`).field('text', 'I think so').field('module', 'TH_VOICELESS')
      .attach('audio', wav, { filename: 'a.wav', contentType: 'audio/wav' }).expect(200)).body;
    assert.ok(r.score >= 80);
    assert.ok(r.achievements.find((a) => a.code === 'FIRST_SHADOWING'));
  });
  test('gravação curta demais', async () => {
    await agent.post(`${E}/pronunciation/assess`).field('text', 'Hi').attach('audio', Buffer.alloc(100), { filename: 'a.wav', contentType: 'audio/wav' }).expect(400);
  });
});

describe('aula ao vivo', () => {
  test('abre mesmo com uma aula escrita em andamento', async () => {
    const written = (await agent.post(`${E}/lessons`).send({ mode: 'lesson' }).expect(201)).body;
    const live = (await agent.post(`${E}/live`).send({ topic: 'música' }).expect(201)).body;
    assert.equal(live.mode, 'live');
    assert.notEqual(live.id, written.id);
    // a aula escrita continua lá para depois
    assert.equal((await agent.get(`${E}/dashboard`).expect(200)).body.activeLessonId, written.id);
    assert.equal((await agent.post(`${E}/live`).send({}).expect(201)).body.id, live.id, 'retoma a mesma sessão ao vivo');
    await agent.post(`/api/conversations/${live.id}/finish`).expect(200);
    await finishActive(written.id, ['answer 1', 'answer 2', 'answer 3', 'answer 4', 'answer 5']);
  });
});

describe('chat livre', () => {
  let t;
  test('cria a conversa e responde com cartão fonético', async () => {
    t = (await agent.get(`${E}/tutor`).expect(200)).body;
    assert.equal(t.mode, 'tutor');
    assert.equal(t.messages.length, 0);
    t = (await agent.post(`/api/tutor/${t.id}/message`).field('text', 'Não consigo falar, me ajuda').expect(200)).body;
    const last = t.messages.at(-1);
    assert.equal(last.kind, 'tutor');
    assert.equal(last.payload.phrases[0].br, 'ai UÉNT tu dhe DJIM');
  });
  test('aceita imagem e só o dono consegue vê-la', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);
    t = (await agent.post(`/api/tutor/${t.id}/message`).attach('image', png, 'foto.png').expect(200)).body;
    const img = t.messages.find((m) => m.payload?.image);
    assert.ok(img);
    assert.equal(img.payload.filePath, undefined, 'caminho do arquivo não vaza');
    await agent.get(`/api/tutor/${t.id}/image/${img.id}`).expect(200);
    const other = request.agent(app);
    await other.post('/api/auth/register').send({ name: 'Zé', email: 'ze@ex.com', password: 'senha1234' }).expect(201);
    await other.get(`/api/tutor/${t.id}/image/${img.id}`).expect(404);
  });
  test('rejeita arquivo que não é imagem', async () => {
    await agent.post(`/api/tutor/${t.id}/message`).attach('image', Buffer.from('%PDF-1.4 xxx'), 'a.pdf').expect(400);
  });
  test('salvar frase no vocabulário sem nova chamada de IA', async () => {
    const w = (await agent.post(`${E}/vocabulary`).send({ word: 'I went to the gym', translation: 'Eu fui à academia', pronunciation: '/aɪ wɛnt/' }).expect(201)).body;
    assert.equal(w.translation, 'Eu fui à academia');
  });
  test('nova conversa', async () => {
    const n = (await agent.post(`${E}/tutor/new`).expect(201)).body;
    assert.notEqual(n.id, t.id);
    assert.equal(n.messages.length, 0);
  });
});

describe('professores', () => {
  test('catálogo com 30 professores e destaques', async () => {
    const meta = (await agent.get('/api/meta').expect(200)).body;
    assert.equal(meta.teachers.length, 30);
    assert.ok(meta.teachers.filter((t) => t.stars === 5).length >= 5);
  });
  test('recomenda e permite escolher; voz inválida é recusada', async () => {
    let d = (await agent.get(`${E}/dashboard`).expect(200)).body;
    assert.equal(d.recommendedTeachers.length, 3);
    assert.equal(d.teacherChosen, false);
    await agent.patch(`${E}/profile`).send({ teacherVoice: 'Inventado' }).expect(400);
    d = (await agent.patch(`${E}/profile`).send({ teacherVoice: 'Achird' }).expect(200)).body;
    assert.equal(d.teacher.voice, 'Achird');
    assert.equal(d.teacherChosen, true);
  });
  test('a personalidade do professor entra no prompt', () => {
    const { teacherSystem } = require('../src/services/ai/prompts');
    const { LANGUAGES } = require('../src/languages');
    const s = teacherSystem(LANGUAGES[0], { level: 'A2', teaching_style: 'balanced', teacher_voice: 'Charon' });
    assert.match(s, /You are Charon/);
    assert.match(s, /business coach/);
  });
});

describe('relatório e metas', () => {
  test('relatório semanal consolida a semana', async () => {
    const r = (await agent.get(`${E}/report`).expect(200)).body;
    assert.ok(r.lessons >= 3);
    assert.equal(r.conversations, 1);
    assert.equal(r.roleplays, 1);
    assert.ok(r.xp > 0);
    assert.equal(r.activeDays, 1);
    assert.ok(r.listening.n >= 1 && r.pronunciation.n >= 1);
    assert.equal(r.areas.length, 5);
    assert.ok(r.nextWeek.skills.length >= 1);
  });
  test('meta diária configurável', async () => {
    const d = (await agent.patch(`${E}/profile`).send({ dailyGoalXp: 30, weeklyGoalLessons: 3 }).expect(200)).body;
    assert.equal(d.profile.dailyGoalXp, 30);
    await agent.patch(`${E}/profile`).send({ dailyGoalXp: 7 }).expect(400);
    const full = (await agent.get(`${E}/dashboard`).expect(200)).body;
    assert.equal(full.goals.daily.done, true);
    assert.equal(full.goals.weekly.goal, 3);
  });
});
