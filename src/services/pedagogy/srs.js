// Repetição espaçada: 1 → 3 → 7 → 14 → 30 dias. Errou: volta para 1. Acertou depois de 30: graduado.
const INTERVALS = [1, 3, 7, 14, 30];
const DAY = 86400000;

/** Retorna { intervalDays, nextReview, graduated } */
function nextReview(currentIntervalDays, success, now = new Date()) {
  if (!success) return { intervalDays: 1, nextReview: new Date(now.getTime() + DAY), graduated: false };
  const next = INTERVALS.find((d) => d > currentIntervalDays);
  if (!next) return { intervalDays: currentIntervalDays, nextReview: null, graduated: true };
  return { intervalDays: next, nextReview: new Date(now.getTime() + next * DAY), graduated: false };
}

module.exports = { INTERVALS, nextReview };
