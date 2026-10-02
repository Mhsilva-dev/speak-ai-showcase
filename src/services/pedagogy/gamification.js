// Conquistas e metas: reforçam o hábito de estudo, sem virar jogo infantil.
const ACHIEVEMENTS = [
  { code: 'FIRST_LESSON', icon: '📘', name: 'Primeira aula', desc: 'Concluiu a primeira aula', test: (s) => s.lessons >= 1 },
  { code: 'LESSONS_10', icon: '📚', name: '10 aulas', desc: 'Concluiu 10 aulas', test: (s) => s.lessons >= 10 },
  { code: 'LESSONS_50', icon: '🎓', name: '50 aulas', desc: 'Concluiu 50 aulas', test: (s) => s.lessons >= 50 },
  { code: 'STREAK_3', icon: '🔥', name: '3 dias seguidos', desc: 'Estudou 3 dias consecutivos', test: (s) => s.streak >= 3 },
  { code: 'STREAK_7', icon: '🔥', name: '7 dias seguidos', desc: 'Uma semana inteira de estudo', test: (s) => s.streak >= 7 },
  { code: 'STREAK_30', icon: '🏅', name: '30 dias seguidos', desc: 'Um mês sem falhar', test: (s) => s.streak >= 30 },
  { code: 'WORDS_50', icon: '🧩', name: '50 palavras', desc: '50 palavras no vocabulário', test: (s) => s.words >= 50 },
  { code: 'WORDS_100', icon: '🏆', name: '100 palavras', desc: '100 palavras no vocabulário', test: (s) => s.words >= 100 },
  { code: 'WORDS_500', icon: '💎', name: '500 palavras', desc: '500 palavras no vocabulário', test: (s) => s.words >= 500 },
  { code: 'FIRST_CONVERSATION', icon: '💬', name: 'Primeira conversa', desc: 'Concluiu uma conversa livre', test: (s) => s.conversations >= 1 },
  { code: 'TALK_30_MIN', icon: '🗣️', name: '30 minutos conversando', desc: 'Somou 30 minutos em conversas', test: (s) => s.conversationMinutes >= 30 },
  { code: 'FIRST_ROLEPLAY', icon: '🎭', name: 'Primeiro roleplay', desc: 'Concluiu um cenário de roleplay', test: (s) => s.roleplays >= 1 },
  { code: 'FIRST_SHADOWING', icon: '🎤', name: 'Primeira gravação', desc: 'Praticou pronúncia com o microfone', test: (s) => s.shadowings >= 1 },
  { code: 'PRONUNCIATION_90', icon: '🎯', name: 'Pronúncia afiada', desc: 'Tirou 90% ou mais numa frase', test: (s) => s.bestPronunciation >= 90 },
  { code: 'PERFECT_LESSON', icon: '⭐', name: 'Aula perfeita', desc: '100% de acertos numa aula', test: (s) => s.perfectLessons >= 1 },
  { code: 'FIRST_MASTERY', icon: '🥇', name: 'Primeira habilidade dominada', desc: 'Chegou a “dominado” numa habilidade', test: (s) => s.masteredSkills >= 1 },
  { code: 'REVIEWS_100', icon: '🔁', name: '100 revisões', desc: 'Revisou 100 flashcards', test: (s) => s.vocabReviews >= 100 },
];

/** Retorna as conquistas novas a partir das estatísticas e das já desbloqueadas */
function newAchievements(stats, unlocked) {
  const have = new Set(unlocked);
  return ACHIEVEMENTS.filter((a) => !have.has(a.code) && a.test(stats));
}

function goalProgress(value, goal) {
  return { value, goal, pct: goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0, done: value >= goal };
}

module.exports = { ACHIEVEMENTS, newAchievements, goalProgress };
