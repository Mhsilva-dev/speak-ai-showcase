// Nivelamento adaptativo: começa no A2, sobe quando acerta, desce quando erra. Decisão 100% do backend.
const PLACEMENT_LEVELS = ['A1', 'A2', 'B1', 'B2'];
const TOTAL_QUESTIONS = 6;
const PASS = 70;
const FAIL = 40;
const MAX_ASSIGNABLE = 'B1'; // conteúdo disponível vai até B1

/** bank: [{level,...}], asked: [{bankIndex, level, score}] → { bankIndex } | null (terminou) */
function nextQuestion(bank, asked) {
  if (asked.length >= TOTAL_QUESTIONS) return null;
  let idx = PLACEMENT_LEVELS.indexOf('A2');
  const last = asked.at(-1);
  if (last) {
    idx = PLACEMENT_LEVELS.indexOf(last.level);
    if (last.score >= PASS) idx = Math.min(PLACEMENT_LEVELS.length - 1, idx + 1);
    else if (last.score < FAIL) idx = Math.max(0, idx - 1);
  }
  const used = new Set(asked.map((a) => a.bankIndex));
  // procura no nível desejado; se acabou, no nível mais próximo
  const order = [0, -1, 1, -2, 2, -3, 3].map((d) => idx + d).filter((i) => i >= 0 && i < PLACEMENT_LEVELS.length);
  for (const li of order) {
    const found = bank.findIndex((q, i) => q.level === PLACEMENT_LEVELS[li] && !used.has(i));
    if (found !== -1) return { bankIndex: found };
  }
  return null;
}

/** Estimativa final: nível demonstrado em cada resposta, com peso maior para as últimas (já calibradas) */
function estimate(asked) {
  if (!asked.length) return { level: 'A1', confidence: 0, demonstrated: 'A1', byArea: {} };
  const shown = asked.map((a) => {
    const i = PLACEMENT_LEVELS.indexOf(a.level);
    return a.score >= PASS ? i : a.score >= FAIL ? i - 0.5 : i - 1;
  });
  const weights = shown.map((_, i) => i + 1);
  const mean = shown.reduce((s, v, i) => s + v * weights[i], 0) / weights.reduce((a, b) => a + b, 0);
  const demonstratedIdx = Math.max(0, Math.min(PLACEMENT_LEVELS.length - 1, Math.round(mean)));
  const variance = shown.reduce((s, v) => s + (v - mean) ** 2, 0) / shown.length;
  const confidence = Math.round(Math.max(40, Math.min(95, 95 - Math.sqrt(variance) * 35 - (TOTAL_QUESTIONS - asked.length) * 5)));
  const demonstrated = PLACEMENT_LEVELS[demonstratedIdx];
  const level = PLACEMENT_LEVELS.indexOf(demonstrated) > PLACEMENT_LEVELS.indexOf(MAX_ASSIGNABLE) ? MAX_ASSIGNABLE : demonstrated;
  const byArea = {};
  for (const a of asked) {
    byArea[a.area] = byArea[a.area] || [];
    byArea[a.area].push(a.score);
  }
  for (const k of Object.keys(byArea)) byArea[k] = Math.round(byArea[k].reduce((x, y) => x + y, 0) / byArea[k].length);
  return { level, demonstrated, confidence, byArea };
}

module.exports = { nextQuestion, estimate, TOTAL_QUESTIONS, PLACEMENT_LEVELS };
