// Contratos das respostas da IA. Tudo que vem do Gemini passa por aqui antes de chegar ao resto do sistema.
const { z } = require('zod');

const str = (max = 2000) => z.string().trim().max(max);
const optStr = (max = 2000) => z.string().trim().max(max).nullish().transform((v) => v || null);

const lessonPlanSchema = z.object({
  introTarget: str(600).min(1),
  introPt: str(800).min(1),
  items: z.array(z.object({
    prompt: str(500).min(1),
    instructionPt: optStr(400),
    modelAnswer: str(500).min(1),
    difficulty: z.coerce.number().int().min(1).max(5).catch(2),
    ref: optStr(40), // "error:12" | "vocab:7" | "exercise:3" | null
  })).min(1).max(12),
});

const SEVERITIES = ['critical', 'relevant', 'minor', 'typo'];

const evaluationSchema = z.object({
  offTopic: z.boolean().catch(false),
  redirectTarget: optStr(600),
  isCorrect: z.boolean(),
  errors: z.array(z.object({
    type: str(60).min(1).transform((s) => s.toUpperCase().replace(/[^A-Z0-9_]/g, '_')),
    original: str(200),
    corrected: str(200),
    severity: z.enum(SEVERITIES).catch('relevant'),
  })).max(8).catch([]),
  correctedSentence: optStr(500),
  feedbackTarget: str(500).min(1),
  explanationPt: optStr(800),
  alternativeExplanationPt: optStr(800),
  hint1: optStr(300),
  hint2: optStr(300),
  partialAnswer: optStr(300),
  phonetic: optStr(300),
  newVocabulary: z.array(z.object({ word: str(80).min(1), translation: str(120) })).max(5).catch([]),
});

const summarySchema = z.object({
  teacherCommentPt: str(800).min(1),
});

const LEVEL = z.enum(['A1', 'A2', 'B1', 'B2']);

const placementBankSchema = z.object({
  questions: z.array(z.object({
    level: LEVEL,
    area: z.enum(['grammar', 'vocabulary', 'reading']).catch('grammar'),
    prompt: str(1200).min(1),
    instructionPt: optStr(300),
    modelAnswer: str(400).min(1),
  })).min(6).max(16),
});

const placementEvalSchema = z.object({
  score: z.coerce.number().min(0).max(100),
  feedbackPt: str(400).min(1),
});

const conversationOpeningSchema = z.object({
  openingTarget: str(600).min(1),
  contextPt: str(500).min(1),
});

const conversationTurnSchema = evaluationSchema.extend({
  feedbackTarget: z.string().trim().max(500).catch(''),
  replyTarget: str(800).min(1),
  scenarioComplete: z.boolean().catch(false),
});

const finalReportSchema = z.object({
  scores: z.object({
    grammar: z.coerce.number().min(0).max(100),
    vocabulary: z.coerce.number().min(0).max(100),
    adequacy: z.coerce.number().min(0).max(100),
    fluency: z.coerce.number().min(0).max(100),
  }),
  commentPt: str(900).min(1),
  betterSentences: z.array(z.object({ original: str(300), better: str(300) })).max(5).catch([]),
  newVocabulary: z.array(z.object({ word: str(80).min(1), translation: str(120) })).max(8).catch([]),
  memories: z.array(str(300)).max(6).catch([]),
  sessionSummaryPt: optStr(500),
});

const vocabEnrichSchema = z.object({
  word: str(80).min(1),
  translation: str(160).min(1),
  meaning: optStr(300),
  examples: z.array(str(300)).max(3).catch([]),
  pronunciation: optStr(120),
  level: optStr(4),
});

const materialSchema = z.object({
  readable: z.boolean().catch(true),
  titlePt: str(160).min(1),
  summaryPt: str(800).min(1),
  reviewPt: str(4000).min(1),
  skillCode: optStr(60),
  exercises: z.array(z.object({
    instruction: str(400),
    question: str(800).min(1),
    options: z.array(str(200)).max(8).catch([]),
    answer: str(400).min(1),
  })).max(12).catch([]),
});

const pronunciationSchema = z.object({
  transcript: str(600),
  score: z.coerce.number().min(0).max(100),
  words: z.array(z.object({
    word: str(60),
    ok: z.boolean(),
    issuePt: optStr(200),
  })).max(40).catch([]),
  feedbackTarget: str(300).min(1),
  tipPt: optStr(500),
});

const phraseSchema = z.object({
  text: str(400).min(1),
  translation: str(400).catch(''),
  ipa: optStr(400),
  br: optStr(400),
  tip: optStr(300),
});

const tutorSchema = z.object({
  reply: str(4000).min(1),
  phrases: z.array(phraseSchema).max(10).catch([]),
});

const translationSchema = z.object({ pt: z.string().trim().max(1200).catch('') });

module.exports = {
  translationSchema,
  tutorSchema, phraseSchema,
  lessonPlanSchema, evaluationSchema, summarySchema, placementBankSchema, placementEvalSchema,
  conversationOpeningSchema, conversationTurnSchema, finalReportSchema, vocabEnrichSchema, materialSchema,
  pronunciationSchema, SEVERITIES,
};
