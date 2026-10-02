// Domínio de cada habilidade (0–100): quanto sobe ou desce a cada acerto/erro e as faixas (iniciante → dominado).
const config = require('../../config');

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

/**
 * Novo domínio de uma habilidade após o resultado final de um item.
 * outcome: { correct, failedAttempts, difficulty }
 */
function calculateMastery(score, { correct, failedAttempts = 0, difficulty = 2 }) {
  if (correct && failedAttempts === 0) return clamp(score + 10 * (0.6 + 0.2 * difficulty)); // dif. 2 → +10
  if (correct) return clamp(score + Math.max(1, 5 - failedAttempts));
  return clamp(score - 6);
}

function masteryBand(score, bands = config.pedagogy.masteryBands) {
  return (bands.find((b) => score <= b.max) || bands[bands.length - 1]).label;
}

// Média móvel para as áreas (speaking/grammar/vocabulary…): cada evidência puxa 15% em direção a 0 ou 100
function updateArea(score, success, weight = 0.15) {
  return clamp(score * (1 - weight) + (success ? 100 : 0) * weight);
}

module.exports = { calculateMastery, masteryBand, updateArea, clamp };
