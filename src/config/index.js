// Configuração única do app, lida do .env. Valores padrão servem para desenvolvimento; em teste a IA é simulada.
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const isTest = process.env.NODE_ENV === 'test';

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3020),
  // Endereço público do site (links dos e-mails); sem ele usa o Host da requisição
  appUrl: (process.env.APP_URL || '').replace(/\/+$/, ''),
  databaseUrl: isTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || (isTest ? 'test-secret' : null),
  // Minutos de conversa por voz por dia para cada aluno (admin: sem limite; dá para mudar por usuário no painel)
  voiceDailyMinutes: Number(process.env.VOICE_DAILY_MINUTES || 15),
  usdBrl: Number(process.env.USD_BRL || 5.5),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  },
  push: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    // Contato exigido pelo Web Push (e-mail ou URL do site)
    subject: process.env.VAPID_SUBJECT || process.env.APP_URL || 'mailto:admin@localhost',
  },
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER || '',
    pass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),
  },
  ai: {
    provider: isTest ? 'mock' : (process.env.AI_PROVIDER || 'gemini'),
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    // Modelos rápidos para tarefas curtas e urgentes (tradução ao vivo)
    fastModels: (process.env.GEMINI_FAST_MODELS || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite').split(',').map((s) => s.trim()).filter(Boolean),
    geminiFallbackModels: (process.env.GEMINI_FALLBACK_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean),
    ttsModels: (process.env.GEMINI_TTS_MODELS || 'gemini-3.1-flash-tts-preview,gemini-2.5-flash-preview-tts').split(',').map((s) => s.trim()).filter(Boolean),
    liveModels: (process.env.GEMINI_LIVE_MODELS || 'gemini-3.8-live,gemini-3.1-flash-live-preview').split(',').map((s) => s.trim()).filter(Boolean),
    liveMaxMinutes: Number(process.env.LIVE_MAX_MINUTES || 20),
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 30000),
    maxRetries: Number(process.env.AI_MAX_RETRIES || 2),
  },
  pedagogy: {
    itemsPerLesson: 5,
    // Faixas de domínio (configuráveis)
    masteryBands: [
      { max: 30, label: 'iniciante' },
      { max: 60, label: 'em desenvolvimento' },
      { max: 80, label: 'bom' },
      { max: 100, label: 'dominado' },
    ],
    masteredThreshold: 81,
    // Erros permitidos por item antes de seguir em frente, por estilo
    maxAttempts: { friendly: 3, balanced: 4, strict: 5 },
    // Em qual erro a resposta completa é revelada (exercício guiado: aluno repete a frase)
    revealAt: { friendly: 2, balanced: 3, strict: 3 },
    // Acertos seguidos para aumentar dificuldade, por estilo
    streakToIncrease: { friendly: 2, balanced: 2, strict: 3 },
    xp: { correctFirstTry: 10, correctAfterRetry: 5, lessonCompleted: 20, conversationTurn: 3, flashcard: 2, shadowing: 3, listening: 3, placement: 15 },
    conversationRetries: { friendly: 0, balanced: 1, strict: 2 },
  },
};

if (!config.jwtSecret) throw new Error('JWT_SECRET é obrigatório');
if (!config.databaseUrl) throw new Error('DATABASE_URL é obrigatório');

module.exports = config;
