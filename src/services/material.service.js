// Upload de foto/PDF de exercício → IA extrai conteúdo e exercícios → aluno revisa ou resolve com o professor
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db/pool');
const teacher = require('./ai/teacher.service');
const students = require('./student.service');

const { HttpError } = students;
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' };
const MAX_BYTES = 10 * 1024 * 1024;

// Confere a assinatura real do arquivo (não confia só no mimetype enviado pelo navegador)
function sniff(buf) {
  if (buf.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (buf.slice(4, 8).toString() === 'ftyp' && /hei[cx]|mif1|heim/.test(buf.slice(8, 12).toString())) return 'image/heic';
  return null;
}

function publicView(m) {
  const a = m.analysis || {};
  return {
    id: m.id,
    createdAt: m.created_at,
    name: m.original_name,
    readable: a.readable !== false,
    titlePt: a.titlePt,
    summaryPt: a.summaryPt,
    reviewPt: a.reviewPt,
    skillCode: a.skillCode,
    // As respostas não vão para o navegador: o professor corrige no backend
    exercises: (a.exercises || []).map(({ instruction, question, options }) => ({ instruction, question, options })),
  };
}

async function upload(userId, slug, file) {
  const { lang, student } = await students.requireStudentLanguage(userId, slug);
  if (!file?.buffer?.length) throw new HttpError(400, 'Envie uma foto ou PDF');
  if (file.buffer.length > MAX_BYTES) throw new HttpError(400, 'Arquivo maior que 10 MB');
  const mime = sniff(file.buffer);
  if (!mime || !TYPES[mime]) throw new HttpError(400, 'Envie uma imagem (JPG, PNG, WEBP, HEIC) ou PDF');

  const dir = path.join(UPLOAD_DIR, String(student.id));
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${crypto.randomUUID()}.${TYPES[mime]}`);
  fs.writeFileSync(filePath, file.buffer);

  const skills = await students.loadSkills(student.id);
  let analysis;
  try {
    analysis = await teacher.analyzeMaterial({ lang, student, skillCodes: skills.map((s) => s.code), file: { mimeType: mime, data: file.buffer.toString('base64') } });
  } catch {
    fs.rmSync(filePath, { force: true });
    throw new HttpError(503, 'Não consegui ler o material agora. Tente de novo em instantes.');
  }
  if (!skills.some((s) => s.code === analysis.skillCode)) analysis.skillCode = null;
  const { rows: [m] } = await db.query(
    `INSERT INTO materials(student_language_id, file_path, mime, original_name, analysis) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [student.id, filePath, mime, String(file.originalname || '').slice(0, 120), analysis]);
  return publicView(m);
}

async function list(userId, slug) {
  const { student } = await students.requireStudentLanguage(userId, slug);
  const { rows } = await db.query('SELECT * FROM materials WHERE student_language_id=$1 ORDER BY id DESC LIMIT 30', [student.id]);
  return { materials: rows.map(publicView) };
}

async function get(userId, slug, id) {
  const { student } = await students.requireStudentLanguage(userId, slug);
  const { rows: [m] } = await db.query('SELECT * FROM materials WHERE id=$1 AND student_language_id=$2', [id, student.id]);
  if (!m) throw new HttpError(404, 'Material não encontrado');
  return publicView(m);
}

async function remove(userId, slug, id) {
  const { student } = await students.requireStudentLanguage(userId, slug);
  const { rows: [m] } = await db.query('DELETE FROM materials WHERE id=$1 AND student_language_id=$2 RETURNING file_path', [id, student.id]);
  if (!m) throw new HttpError(404, 'Material não encontrado');
  fs.rmSync(m.file_path, { force: true });
  return { ok: true };
}

module.exports = { upload, list, get, remove, sniff, MAX_BYTES };
