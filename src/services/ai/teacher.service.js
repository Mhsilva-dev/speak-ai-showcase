// Fachada das tarefas linguísticas do professor. O resto do sistema só fala com este módulo.
const config = require('../../config');
const { generateJSON } = require('./gemini.service');
const S = require('./schemas');
const prompts = require('./prompts');
const mock = require('./mock.provider');

const useMock = () => config.ai.provider === 'mock';

function run(task, ctx, { prompt, schema, temperature, media, timeoutMs, fast, maxOutputTokens }) {
  if (useMock()) return Promise.resolve(schema.parse(mock[task](ctx)));
  return generateJSON({
    task,
    system: prompts.teacherSystem(ctx.lang, ctx.student || { level: 'A2', teaching_style: 'balanced' }),
    prompt, schema, temperature, media, timeoutMs, fast, maxOutputTokens,
  });
}

const generateLessonPlan = (ctx) => run('lessonPlan', ctx, { prompt: prompts.lessonPlanPrompt(ctx), schema: S.lessonPlanSchema, temperature: 0.8 });
const generateDailyPlan = (ctx) => run('dailyPlan', ctx, { prompt: prompts.dailyPlanPrompt(ctx), schema: S.lessonPlanSchema, temperature: 0.8 });
const evaluateAnswer = (ctx) => run('evaluation', ctx, { prompt: prompts.evaluationPrompt(ctx), schema: S.evaluationSchema, temperature: 0.3 });
const placementBank = (ctx) => run('placementBank', ctx, { prompt: prompts.placementBankPrompt(ctx), schema: S.placementBankSchema, temperature: 0.9, timeoutMs: 60000 });
const placementEval = (ctx) => run('placementEval', ctx, { prompt: prompts.placementEvalPrompt(ctx), schema: S.placementEvalSchema, temperature: 0.2 });
const conversationOpening = (ctx) => run('conversationOpening', ctx, { prompt: prompts.conversationOpeningPrompt(ctx), schema: S.conversationOpeningSchema, temperature: 0.9 });
const conversationTurn = (ctx) => run('conversationTurn', ctx, { prompt: prompts.conversationTurnPrompt(ctx), schema: S.conversationTurnSchema, temperature: 0.6 });
const finalReport = (ctx) => run('finalReport', ctx, { prompt: prompts.finalReportPrompt(ctx), schema: S.finalReportSchema, temperature: 0.3 });
const enrichWord = (ctx) => run('enrichWord', ctx, { prompt: prompts.vocabEnrichPrompt(ctx), schema: S.vocabEnrichSchema, temperature: 0.3 });
const analyzeMaterial = (ctx) => run('material', ctx, {
  prompt: prompts.materialPrompt(ctx), schema: S.materialSchema, temperature: 0.2, media: [ctx.file], timeoutMs: 90000,
});
const translateLine = (ctx) => run('translate', ctx, { prompt: prompts.translatePrompt(ctx), schema: S.translationSchema, temperature: 0.1, timeoutMs: 8000, fast: true, maxOutputTokens: 1024 });
const tutorReply = (ctx) => run('tutor', ctx, { prompt: prompts.tutorPrompt(ctx), schema: S.tutorSchema, temperature: 0.5, media: ctx.image ? [ctx.image] : [], timeoutMs: 60000 });
const assessPronunciation = (ctx) => run('pronunciation', ctx, {
  prompt: prompts.pronunciationPrompt(ctx), schema: S.pronunciationSchema, temperature: 0.2, media: [ctx.audio], timeoutMs: 45000,
});

// O resumo é "enfeite": se a IA falhar, a aula termina mesmo assim com um texto padrão.
async function summarizeLesson(ctx) {
  try {
    return await run('summary', ctx, { prompt: prompts.summaryPrompt(ctx), schema: S.summarySchema });
  } catch {
    return { teacherCommentPt: ctx.stats.accuracy >= 70
      ? `Bom trabalho em ${ctx.skill.name}! Vamos continuar consolidando nas próximas aulas.`
      : `${ctx.skill.name} ainda precisa de prática — vamos revisar isso na próxima aula.` };
  }
}

module.exports = {
  generateLessonPlan, generateDailyPlan, evaluateAnswer, summarizeLesson, placementBank, placementEval,
  conversationOpening, conversationTurn, finalReport, enrichWord, analyzeMaterial, assessPronunciation, tutorReply, translateLine,
};
