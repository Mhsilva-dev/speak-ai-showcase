// Pronúncia (shadowing) e listening (ditado). A avaliação de fala usa o Gemini com áudio hoje,
// mas fica isolada aqui para trocar por uma API especializada (ex.: Azure Pronunciation Assessment) no futuro.
const config = require('../../config');
const db = require('../../db/pool');
const teacher = require('../ai/teacher.service');
const progress = require('../progress.service');
const students = require('../student.service');
const { compareText } = require('../pedagogy/textCompare');

const { HttpError } = students;
const AUDIO_TYPES = ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/aac', 'audio/flac', 'audio/webm', 'audio/mp4'];

function catalog(lang, student) {
  const level = student?.level && lang.listening[student.level] ? student.level : 'A1';
  return {
    modules: lang.pronunciation,
    listening: { level, sentences: lang.listening[level] },
  };
}

async function overview(userId, slug) {
  const { lang, student } = await students.requireStudentLanguage(userId, slug);
  const { rows: stats } = await db.query(
    `SELECT module, round(avg(score))::int AS avg, max(score)::int AS best, count(*)::int AS attempts
     FROM pronunciation_attempts WHERE student_language_id=$1 AND kind='shadowing' AND module IS NOT NULL GROUP BY module`, [student.id]);
  const { rows: recent } = await db.query(
    `SELECT kind, module, text, score, problems, created_at FROM pronunciation_attempts WHERE student_language_id=$1 ORDER BY id DESC LIMIT 10`, [student.id]);
  return { ...catalog(lang, student), stats, recent };
}

function findModule(lang, code) {
  return code ? lang.pronunciation.find((m) => m.code === code) || null : null;
}

async function assess(userId, slug, { file, text, module: moduleCode }) {
  const { lang, student } = await students.requireStudentLanguage(userId, slug);
  const target = String(text || '').trim().slice(0, 300);
  if (!target) throw new HttpError(400, 'Frase ausente');
  if (!file?.buffer?.length) throw new HttpError(400, 'Áudio ausente');
  if (file.buffer.length < 3000) throw new HttpError(400, 'Gravação muito curta — segure o botão e fale a frase inteira');
  const mime = (file.mimetype || '').split(';')[0];
  if (!AUDIO_TYPES.includes(mime)) throw new HttpError(400, 'Formato de áudio não suportado');
  const module = findModule(lang, moduleCode);

  let r;
  try {
    r = await teacher.assessPronunciation({ lang, student, text: target, module, audio: { mimeType: mime === 'audio/x-wav' || mime === 'audio/wave' ? 'audio/wav' : mime, data: file.buffer.toString('base64') } });
  } catch {
    throw new HttpError(503, 'Não consegui analisar o áudio agora. Tente de novo.');
  }
  // Cruza com a comparação textual para não depender só da nota da IA
  const textual = compareText(target, r.transcript);
  const score = Math.round(r.score * 0.7 + textual.score * 0.3);
  const problems = r.words.filter((w) => !w.ok).map((w) => ({ word: w.word, issuePt: w.issuePt }));

  const achievements = await db.tx(async (c) => {
    await c.query(
      `INSERT INTO pronunciation_attempts(student_language_id, kind, module, text, transcript, score, problems)
       VALUES ($1,'shadowing',$2,$3,$4,$5,$6)`, [student.id, module?.code || null, target, r.transcript, score, JSON.stringify(problems)]);
    await progress.bumpArea(c, student.id, 'pronunciation', score >= 70, 0.12);
    await progress.addXp(c, student.id, config.pedagogy.xp.shadowing, 'shadowing');
    await progress.markStudied(c, student.id);
    return progress.checkAchievements(c, student.id);
  });
  return { score, transcript: r.transcript, words: r.words, problems, feedbackTarget: r.feedbackTarget, tipPt: r.tipPt, achievements };
}

/** Ditado: o aluno ouve e digita. Correção local, sem IA. */
async function checkListening(userId, slug, { text, typed }) {
  const { lang, student } = await students.requireStudentLanguage(userId, slug);
  const all = Object.values(lang.listening).flat();
  if (!all.includes(text)) throw new HttpError(400, 'Frase desconhecida');
  const result = compareText(text, String(typed || '').slice(0, 400));
  const achievements = await db.tx(async (c) => {
    await c.query(
      `INSERT INTO pronunciation_attempts(student_language_id, kind, text, transcript, score, problems) VALUES ($1,'listening',$2,$3,$4,$5)`,
      [student.id, text, typed, result.score, JSON.stringify(result.words.filter((w) => !w.ok))]);
    await progress.bumpArea(c, student.id, 'listening', result.score >= 80, 0.12);
    await progress.addXp(c, student.id, config.pedagogy.xp.listening, 'listening');
    await progress.markStudied(c, student.id);
    return progress.checkAchievements(c, student.id);
  });
  return { ...result, text, achievements };
}

module.exports = { overview, assess, checkListening, AUDIO_TYPES };
