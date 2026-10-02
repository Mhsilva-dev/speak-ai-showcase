// Registro de idiomas: adicionar um idioma = novo arquivo de conteúdo + entrada aqui.
const en = require('./en');
const es = require('./es');

const LANGUAGES = [en, es];

const TOPICS = [
  'livros', 'séries', 'filmes', 'música', 'viagens', 'trabalho', 'tecnologia', 'academia',
  'comida', 'família', 'cotidiano', 'jogos', 'futebol', 'estudos', 'relacionamentos',
  'negócios', 'situações profissionais',
];

// Tópicos preferidos por objetivo do aluno (usado no "Surpreenda-me" e no foco de hoje)
const GOAL_TOPICS = {
  conversacao: ['cotidiano', 'filmes', 'séries', 'música', 'comida', 'família'],
  trabalho: ['trabalho', 'negócios', 'situações profissionais', 'tecnologia'],
  viagem: ['viagens', 'comida', 'cotidiano'],
  escola: ['estudos', 'livros', 'família', 'cotidiano'],
  faculdade: ['estudos', 'livros', 'tecnologia'],
  prova: ['estudos', 'livros', 'cotidiano'],
  entrevista: ['situações profissionais', 'trabalho', 'negócios'],
  fluencia: TOPICS,
};

const GOALS = {
  conversacao: 'conversar melhor',
  trabalho: 'usar o idioma no trabalho',
  viagem: 'viajar',
  escola: 'escola',
  faculdade: 'faculdade',
  prova: 'passar em uma prova',
  entrevista: 'entrevista de emprego',
  fluencia: 'fluência geral',
};

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const AREAS = ['speaking', 'grammar', 'vocabulary', 'listening', 'pronunciation'];

function getLanguage(slugOrCode) {
  return LANGUAGES.find((l) => l.slug === slugOrCode || l.code === slugOrCode) || null;
}

module.exports = { LANGUAGES, TOPICS, GOAL_TOPICS, GOALS, LEVELS, AREAS, getLanguage };
