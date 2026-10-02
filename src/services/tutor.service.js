// Chat livre com o professor: qualquer dúvida, frases para aprender e imagens (foto de livro, placa, print…).
// As respostas trazem "cartões de frase" com fonética, pronúncia aproximada para brasileiros, áudio e gravação.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db/pool');
const teacher = require('./ai/teacher.service');
const progress = require('./progress.service');
const students = require('./student.service');
const lessons = require('./lesson.service');
const { sniff } = require('./material.service');

const { HttpError } = students;
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
const busy = new Set();

async function getOrCreate(slId) {
  const { rows: [t] } = await db.query(
    `SELECT id FROM lessons WHERE student_language_id=$1 AND mode='tutor' AND state <> 'LESSON_COMPLETED' ORDER BY id DESC LIMIT 1`, [slId]);
  if (t) return t.id;
  const { rows: [n] } = await db.query(
    `INSERT INTO lessons(student_language_id, topic, state, mode) VALUES ($1,'chat livre','WAITING_FOR_ANSWER','tutor') RETURNING id`, [slId]);
  return n.id;
}

async function thread(userId, slug) {
  const { student } = await students.requireStudentLanguage(userId, slug);
  return lessons.getLesson(userId, await getOrCreate(student.id));
}

/** Começa uma conversa nova (a anterior fica no histórico) */
async function reset(userId, slug) {
  const { student } = await students.requireStudentLanguage(userId, slug);
  await db.query(`UPDATE lessons SET state='LESSON_COMPLETED', completed_at=now() WHERE student_language_id=$1 AND mode='tutor' AND state <> 'LESSON_COMPLETED'`, [student.id]);
  return thread(userId, slug);
}

async function send(userId, threadId, { text, file }) {
  const msg = String(text || '').trim().slice(0, 2000);
  if (!msg && !file) throw new HttpError(400, 'Escreva uma mensagem ou envie uma imagem');
  const L = await lessons.loadLessonFor(userId, threadId);
  if (L.mode !== 'tutor' || L.state === 'LESSON_COMPLETED') throw new HttpError(400, 'Conversa encerrada');

  let image = null;
  if (file?.buffer?.length) {
    const mime = sniff(file.buffer);
    if (!IMAGE_EXT[mime]) throw new HttpError(400, 'Envie uma imagem JPG, PNG, WEBP ou HEIC');
    if (file.buffer.length > 8 * 1024 * 1024) throw new HttpError(400, 'Imagem maior que 8 MB');
    const dir = path.join(UPLOAD_DIR, String(L.sl_id));
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `chat-${crypto.randomUUID()}.${IMAGE_EXT[mime]}`);
    fs.writeFileSync(filePath, file.buffer);
    image = { mime, filePath, data: file.buffer.toString('base64') };
  }

  if (busy.has(threadId)) throw new HttpError(409, 'Aguarde a resposta anterior');
  busy.add(threadId);
  try {
    const { lang, student } = await students.requireStudentLanguage(userId, L.slug);
    const { rows: history } = await db.query(
      `SELECT role, content FROM (SELECT id, role, content FROM messages WHERE lesson_id=$1 ORDER BY id DESC LIMIT 16) t ORDER BY id`, [threadId]);
    await lessons.addMessage(db, threadId, 'student', 'answer', msg || '📷 (imagem)', image ? { image: path.basename(image.filePath), filePath: image.filePath } : null);

    let r;
    try {
      const memories = await progress.loadMemories(L.sl_id, db);
      r = await teacher.tutorReply({ lang, student, history, text: msg, hasImage: !!image, image: image && { mimeType: image.mime, data: image.data }, memories });
    } catch {
      await lessons.addMessage(db, threadId, 'teacher', 'notice', 'Não consegui responder agora. Mande de novo em instantes.');
      return lessons.getLesson(userId, threadId);
    }
    await db.tx(async (c) => {
      await lessons.addMessage(c, threadId, 'teacher', 'tutor', r.reply, { phrases: r.phrases });
      await progress.addXp(c, L.sl_id, 2, 'tutor');
      await progress.markStudied(c, L.sl_id);
    });
    return lessons.getLesson(userId, threadId);
  } finally {
    busy.delete(threadId);
  }
}

/** Imagem enviada no chat (só para o dono) */
async function imageFile(userId, threadId, messageId) {
  await lessons.loadLessonFor(userId, threadId);
  const { rows: [m] } = await db.query(`SELECT payload FROM messages WHERE id=$1 AND lesson_id=$2`, [messageId, threadId]);
  const p = m?.payload?.filePath;
  if (!p || !p.startsWith(UPLOAD_DIR) || !fs.existsSync(p)) throw new HttpError(404, 'Imagem não encontrada');
  return p;
}

module.exports = { thread, reset, send, imageFile };
