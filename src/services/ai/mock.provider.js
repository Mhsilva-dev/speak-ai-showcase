// Provedor determinístico para testes (AI_PROVIDER=mock). Correto = igual à resposta-modelo (ignorando caixa/pontuação).
const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, '').replace(/\s+/g, ' ').trim();

function lessonPlan({ skill, count }) {
  return {
    introTarget: `Let's practice ${skill.name}!`,
    introPt: `Hoje vamos praticar ${skill.name}.`,
    items: Array.from({ length: count }, (_, i) => ({
      prompt: `Question ${i + 1}?`, instructionPt: null, modelAnswer: `answer ${i + 1}`, difficulty: Math.min(5, 1 + i),
    })),
  };
}

function dailyPlan({ reviewErrors, words, skillCount }) {
  const refs = [...reviewErrors.map((e) => `error:${e.id}`), ...words.map((w) => `vocab:${w.id}`), ...Array(skillCount).fill(null)];
  return {
    introTarget: 'Daily lesson!', introPt: 'Aula do dia.',
    items: refs.map((ref, i) => ({ prompt: `Daily ${i + 1}?`, instructionPt: null, modelAnswer: `answer ${i + 1}`, difficulty: 2, ref })),
  };
}

function evaluation({ item, answer }) {
  if (/OFFTOPIC/.test(answer)) {
    return { offTopic: true, redirectTarget: `Let's use that to practice! ${item.prompt}`, isCorrect: false, errors: [], feedbackTarget: 'Interesting!' };
  }
  const ok = norm(answer) === norm(item.model_answer);
  return ok
    ? { offTopic: false, isCorrect: true, errors: [], feedbackTarget: 'Great!', newVocabulary: [{ word: 'great', translation: 'ótimo' }] }
    : {
      offTopic: false,
      isCorrect: false,
      errors: [{ type: 'PAST_SIMPLE', original: answer.slice(0, 50), corrected: item.model_answer, severity: 'critical' }],
      correctedSentence: item.model_answer,
      feedbackTarget: 'Almost!',
      explanationPt: 'Explicação.',
      alternativeExplanationPt: 'Outra explicação.',
      hint1: 'Hint one',
      hint2: 'Dica dois',
      partialAnswer: `${item.model_answer.split(' ')[0]} ...`,
      newVocabulary: [],
    };
}

const summary = () => ({ teacherCommentPt: 'Boa aula!' });

function placementBank() {
  const levels = ['A1', 'A2', 'B1', 'B2'];
  return { questions: levels.flatMap((level) => [0, 1, 2].map((i) => ({ level, area: 'grammar', prompt: `${level} q${i}`, instructionPt: null, modelAnswer: `${level} ok` }))) };
}

// Mock: resposta "pass" = 90, "meh" = 55, outra coisa = 10
const placementEval = ({ answer }) => ({ score: /pass/.test(answer) ? 90 : /meh/.test(answer) ? 55 : 10, feedbackPt: 'Ok.' });

const conversationOpening = ({ mode }) => ({ openingTarget: mode === 'roleplay' ? 'Welcome to our hotel!' : 'Hi! How are you?', contextPt: 'Contexto.' });

function conversationTurn({ answer, turn, targetTurns }) {
  if (/OFFTOPIC/.test(answer)) return { offTopic: true, redirectTarget: 'Back to English!', isCorrect: false, errors: [], feedbackTarget: 'Hm', replyTarget: 'Back to English!' };
  const wrong = /wrong/.test(answer);
  return {
    offTopic: false,
    isCorrect: !wrong,
    errors: wrong ? [{ type: 'VERB_TO_BE', original: answer.split(/\s+/)[1] || answer, corrected: 'is', severity: 'critical' }] : /relevant/.test(answer) ? [{ type: 'ARTICLE', original: answer.split(/\s+/)[1], corrected: 'an', severity: 'relevant' }] : [],
    correctedSentence: wrong ? 'She is fine.' : null,
    feedbackTarget: 'Almost!',
    explanationPt: wrong ? 'Use is.' : null,
    hint1: wrong ? 'Check the verb.' : null,
    replyTarget: `Reply ${turn}/${targetTurns}`,
    scenarioComplete: /done/.test(answer),
    newVocabulary: [],
  };
}

const finalReport = ({ scenario }) => ({ scores: { grammar: 70, vocabulary: 80, adequacy: 90, fluency: 60 }, commentPt: 'Boa conversa!', betterSentences: [], memories: scenario ? [] : ['Trabalha como programador'], sessionSummaryPt: 'Conversaram sobre filmes.' });
const enrichWord = ({ word }) => ({ word, translation: 'tradução', meaning: null, examples: [`I like ${word}.`], pronunciation: '/x/', level: 'A2' });
const material = () => ({
  readable: true, titlePt: 'Past Simple', summaryPt: 'Exercícios de passado.', reviewPt: 'Revisão.', skillCode: 'PAST_SIMPLE',
  exercises: [{ instruction: 'Complete', question: 'I ___ (go) home.', options: [], answer: 'went' }, { instruction: 'Complete', question: 'She ___ (eat).', options: [], answer: 'ate' }],
});
const pronunciation = ({ text }) => ({ transcript: text, score: 85, words: text.split(' ').map((w) => ({ word: w, ok: true })), feedbackTarget: 'Nice!', tipPt: null });

const tutor = ({ text }) => ({
  reply: /ajuda|não consigo/i.test(text || '') ? 'Vamos falar juntos, por partes:' : 'Claro! Veja:',
  phrases: [{ text: 'I went to the gym', translation: 'Eu fui à academia', ipa: '/aɪ wɛnt tə ðə dʒɪm/', br: 'ai UÉNT tu dhe DJIM', tip: null }],
});

const translate = ({ text }) => ({ pt: `(tradução) ${text}` });

module.exports = {
  translate,
  tutor,
  lessonPlan, dailyPlan, evaluation, summary, placementBank, placementEval, conversationOpening, conversationTurn,
  finalReport, enrichWord, material, pronunciation,
};
