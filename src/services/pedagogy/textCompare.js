// Comparação palavra a palavra (ditado / reconhecimento de fala), tolerante a pontuação, caixa e acentos opcionais.
const norm = (w) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ']/g, '');
const tokens = (s) => String(s).split(/\s+/).map((w) => ({ raw: w.replace(/[.,!?;:¿¡"]/g, ''), n: norm(w) })).filter((t) => t.n);

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** Alinha as palavras esperadas com as digitadas (LCS) e marca acertos; palavra com 1 letra trocada conta meio ponto */
function compareText(expected, typed) {
  const E = tokens(expected);
  const T = tokens(typed);
  const lcs = Array.from({ length: E.length + 1 }, () => Array(T.length + 1).fill(0));
  const close = (a, b) => a === b || (a.length > 3 && levenshtein(a, b) === 1);
  for (let i = E.length - 1; i >= 0; i--) {
    for (let j = T.length - 1; j >= 0; j--) {
      lcs[i][j] = close(E[i].n, T[j].n) ? 1 + lcs[i + 1][j + 1] : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const words = E.map((e) => ({ word: e.raw, ok: false, heard: null }));
  let i = 0; let j = 0;
  while (i < E.length && j < T.length) {
    if (close(E[i].n, T[j].n)) { words[i] = { word: E[i].raw, ok: true, exact: E[i].n === T[j].n, heard: T[j].raw }; i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  const points = words.reduce((s, w) => s + (w.ok ? (w.exact ? 1 : 0.5) : 0), 0);
  const extra = Math.max(0, T.length - E.length);
  const score = E.length ? Math.max(0, Math.round((points / E.length) * 100 - extra * 5)) : 0;
  return { score, words };
}

module.exports = { compareText, levenshtein };
