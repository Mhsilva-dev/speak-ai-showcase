// Memória estruturada do aluno por idioma (PostgreSQL)
const db = require('../db/pool');
const { getLanguage, LEVELS, GOALS, AREAS } = require('../languages');
const engine = require('./pedagogy/engine');
const { masteryBand } = require('./pedagogy/mastery');
const teachers = require('../languages/teachers');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const STYLES = ['friendly', 'balanced', 'strict'];

function resolveLanguage(slug) {
  const lang = getLanguage(slug);
  if (!lang) throw new HttpError(404, 'Idioma não encontrado');
  return lang;
}

async function getStudentLanguage(userId, slug, client = db) {
  const lang = resolveLanguage(slug);
  const { rows } = await client.query(
    `SELECT sl.*, l.code, l.slug FROM student_languages sl JOIN languages l ON l.id = sl.language_id
     WHERE sl.user_id = $1 AND l.slug = $2`, [userId, lang.slug]);
  return { lang, student: rows[0] || null };
}

async function requireStudentLanguage(userId, slug, client = db) {
  const r = await getStudentLanguage(userId, slug, client);
  if (!r.student) throw new HttpError(409, 'Configure este idioma antes de começar');
  return r;
}

function validateProfile(input, partial = false) {
  const out = {};
  if (input.level !== undefined || !partial) {
    if (!LEVELS.includes(input.level)) throw new HttpError(400, 'Nível inválido');
    out.level = input.level;
  }
  if (input.goal !== undefined || !partial) {
    if (!GOALS[input.goal]) throw new HttpError(400, 'Objetivo inválido');
    out.goal = input.goal;
  }
  if (input.teachingStyle !== undefined || !partial) {
    const s = input.teachingStyle || 'balanced';
    if (!STYLES.includes(s)) throw new HttpError(400, 'Estilo inválido');
    out.teaching_style = s;
  }
  if (input.interests !== undefined) {
    if (!Array.isArray(input.interests)) throw new HttpError(400, 'Interesses inválidos');
    out.interests = input.interests.map(String).map((s) => s.trim().slice(0, 40)).filter(Boolean).slice(0, 10);
  }
  if (input.teacherVoice !== undefined) {
    if (!teachers.TEACHERS.some((t) => t.voice === input.teacherVoice)) throw new HttpError(400, 'Professor inválido');
    out.teacher_voice = input.teacherVoice;
  }
  if (input.dailyGoalXp !== undefined) {
    const v = Number(input.dailyGoalXp);
    if (![30, 50, 100, 150].includes(v)) throw new HttpError(400, 'Meta diária inválida');
    out.daily_goal_xp = v;
  }
  if (input.weeklyGoalLessons !== undefined) {
    const v = Number(input.weeklyGoalLessons);
    if (!Number.isInteger(v) || v < 1 || v > 14) throw new HttpError(400, 'Meta semanal inválida');
    out.weekly_goal_lessons = v;
  }
  return out;
}

async function enroll(userId, slug, input) {
  const lang = resolveLanguage(slug);
  const p = validateProfile(input);
  return db.tx(async (c) => {
    const { rows: [language] } = await c.query('SELECT id FROM languages WHERE slug=$1 AND active', [lang.slug]);
    if (!language) throw new HttpError(404, 'Idioma indisponível');
    const { rows: [sl] } = await c.query(
      `INSERT INTO student_languages(user_id, language_id, level, goal, teaching_style, interests, daily_goal_xp, weekly_goal_lessons, placement, teacher_voice)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (user_id, language_id) DO NOTHING RETURNING *`,
      [userId, language.id, p.level, p.goal, p.teaching_style, p.interests || [], p.daily_goal_xp || 50, p.weekly_goal_lessons || 5, input.placement || null, p.teacher_voice || null]);
    if (!sl) throw new HttpError(409, 'Idioma já configurado');
    await c.query(
      `INSERT INTO skill_mastery(student_language_id, skill_id, score)
       SELECT $1, s.id, CASE WHEN array_position($3::text[], s.cefr_level) < array_position($3::text[], $2) THEN 70 ELSE 0 END
       FROM skills s WHERE s.language_id = $4`, [sl.id, p.level, LEVELS, language.id]);
    const base = LEVELS.indexOf(p.level) * 20;
    for (const area of AREAS) {
      const start = ['listening', 'pronunciation'].includes(area) ? 0 : base;
      await c.query('INSERT INTO area_progress(student_language_id, area, score) VALUES ($1,$2,$3)', [sl.id, area, start]);
    }
    return sl;
  });
}

async function updateProfile(userId, slug, input) {
  const { student } = await requireStudentLanguage(userId, slug);
  const p = validateProfile(input, true);
  const keys = Object.keys(p);
  if (!keys.length) return student;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await db.query(`UPDATE student_languages SET ${sets} WHERE id = $1 RETURNING *`, [student.id, ...keys.map((k) => p[k])]);
  return rows[0];
}

async function loadSkills(studentLanguageId, client = db) {
  const { rows } = await client.query(
    `SELECT s.id, s.code, s.name, s.category, s.cefr_level, s.description, s.order_index, COALESCE(m.score,0) AS score
     FROM skill_mastery m JOIN skills s ON s.id = m.skill_id WHERE m.student_language_id = $1 ORDER BY s.order_index`,
    [studentLanguageId]);
  return rows;
}

async function loadOpenErrors(studentLanguageId, client = db) {
  const { rows } = await client.query(
    `SELECT * FROM student_errors WHERE student_language_id = $1 AND NOT resolved ORDER BY frequency DESC, last_seen DESC`,
    [studentLanguageId]);
  return rows;
}

async function recentTopics(studentLanguageId, client = db) {
  const { rows } = await client.query(
    'SELECT topic FROM lessons WHERE student_language_id=$1 ORDER BY started_at DESC LIMIT 3', [studentLanguageId]);
  return rows.map((r) => r.topic);
}

async function getDashboard(userId, slug) {
  const { lang, student } = await getStudentLanguage(userId, slug);
  const language = { slug: lang.slug, code: lang.code, name: lang.name, namePt: lang.namePt, flag: lang.flag };
  if (!student) return { language, enrolled: false };

  const [skills, errors, topics, areasQ, activeQ, lessonsQ, vocabQ] = await Promise.all([
    loadSkills(student.id),
    loadOpenErrors(student.id),
    recentTopics(student.id),
    db.query('SELECT area, score FROM area_progress WHERE student_language_id=$1', [student.id]),
    db.query(`SELECT id, mode FROM lessons WHERE student_language_id=$1 AND state <> 'LESSON_COMPLETED' AND mode IN ('lesson','daily','words','material') ORDER BY id DESC LIMIT 1`, [student.id]),
    db.query(`SELECT l.id, l.topic, l.mode, l.completed_at, l.summary, s.name AS skill FROM lessons l LEFT JOIN skills s ON s.id=l.skill_id
              WHERE l.student_language_id=$1 AND l.state='LESSON_COMPLETED' AND l.mode <> 'tutor' ORDER BY l.completed_at DESC LIMIT 6`, [student.id]),
    db.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE next_review <= now())::int AS due
              FROM vocabulary WHERE student_language_id=$1`, [student.id]),
  ]);

  const plan = engine.getNextLesson({ skills, errors, student, recentTopics: topics }, () => 0);
  const dailyReview = plan ? engine.selectDailyReview(errors, plan.skill.id) : [];
  // Som de pronúncia a focar: menor média; sem tentativas, o primeiro do catálogo
  const { rows: pron } = await db.query(
    `SELECT module, avg(score) AS avg FROM pronunciation_attempts WHERE student_language_id=$1 AND kind='shadowing' AND module IS NOT NULL
     GROUP BY module ORDER BY avg LIMIT 1`, [student.id]);
  const pronModule = lang.pronunciation.find((m) => m.code === pron[0]?.module && pron[0].avg < 85)
    || lang.pronunciation.find((m) => !pron.some((p) => p.module === m.code)) || lang.pronunciation[0];
  const areaMap = Object.fromEntries(areasQ.rows.map((r) => [r.area, r.score]));
  // streak só vale se estudou hoje ou ontem
  const { rows: [{ alive }] } = await db.query(
    `SELECT ($1::date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1) AS alive`, [student.last_study_date]);

  return {
    language,
    enrolled: true,
    profile: {
      level: student.level, goal: student.goal, teachingStyle: student.teaching_style, interests: student.interests,
      dailyGoalXp: student.daily_goal_xp, weeklyGoalLessons: student.weekly_goal_lessons,
    },
    placement: student.placement,
    teacher: teachers.publicTeacher(teachers.getTeacher(student.teacher_voice, lang.code)),
    teacherChosen: !!student.teacher_voice,
    recommendedTeachers: teachers.recommend(student),
    level: student.level,
    xp: student.xp,
    streak: student.last_study_date && alive ? student.streak_days : 0,
    progress: engine.levelProgress(skills, student.level),
    areas: AREAS.map((a) => ({ area: a, score: areaMap[a] ?? 0, available: true })),
    todayFocus: plan && {
      skill: { code: plan.skill.code, name: plan.skill.name, level: plan.skill.cefr_level, score: plan.skill.score },
      topic: plan.topic,
      review: plan.reviewErrors.map((e) => ({ actual: e.actual, expected: e.expected, type: e.error_type })),
      pronunciation: pronModule && { code: pronModule.code, title: pronModule.title, ipa: pronModule.ipa },
    },
    dailyReview: dailyReview.map((e) => ({ actual: e.actual, expected: e.expected, source: e.source })),
    activeLessonId: activeQ.rows[0]?.id || null,
    activeLessonMode: activeQ.rows[0]?.mode || null,
    recentLessons: lessonsQ.rows.map((l) => ({ id: l.id, topic: l.topic, mode: l.mode, skill: l.skill, completedAt: l.completed_at, accuracy: l.summary?.accuracy })),
    recurringErrors: errors.slice(0, 5).map((e) => ({ type: e.error_type, actual: e.actual, expected: e.expected, frequency: e.frequency })),
    skills: skills.map((s) => ({ code: s.code, name: s.name, level: s.cefr_level, score: s.score, band: masteryBand(s.score) })),
    vocabulary: vocabQ.rows[0],
  };
}

module.exports = {
  HttpError, STYLES, resolveLanguage, getStudentLanguage, requireStudentLanguage, enroll, updateProfile,
  loadSkills, loadOpenErrors, recentTopics, getDashboard,
};
