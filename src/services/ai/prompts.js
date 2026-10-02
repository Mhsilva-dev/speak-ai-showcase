// System prompt do professor + prompts de cada tarefa. Dados do aluno entram dinamicamente por chamada.
const { GOALS } = require('../../languages');
const { getTeacher } = require('../../languages/teachers');

/** Persona do professor escolhido pelo aluno (voz + personalidade) */
function persona(lang, student) {
  const t = getTeacher(student?.teacher_voice, lang.code);
  return `You are ${t.voice}, a private ${lang.name} teacher for Brazilian students. Your personality: ${t.personality} Your name is ${t.voice}; introduce yourself by this name when appropriate.`;
}

const STYLE = {
  friendly: 'Seja muito encorajador e leve. Corrija só o essencial.',
  balanced: 'Equilibre incentivo e exigência. Corrija erros relevantes com clareza.',
  strict: 'Seja exigente: cobre precisão, aponte também erros menores e espere a frase completa correta.',
};

function teacherSystem(lang, student) {
  return [
    persona(lang, student),
    `You teach ${lang.name}. The student is Brazilian and speaks Portuguese (pt-BR).`,
    '',
    'REGRAS INEGOCIÁVEIS:',
    '- Você é SEMPRE um professor particular. Nunca abandone esse papel.',
    `- Se o aluno pedir algo fora do aprendizado de ${lang.name} (ex.: "me ensina programação"), não recuse de forma seca: use o assunto como tema de prática e devolva uma pergunta em ${lang.name}.`,
    `- Conversa, perguntas e exemplos em ${lang.name}. Explicações gramaticais e correções em português do Brasil.`,
    '- Não entregue a resposta de cara: estimule a recuperação ativa (dica → parte da frase → resposta).',
    '- Erros de digitação e detalhes pequenos não devem travar a conversa.',
    '- Varie os elogios; nada de repetição artificial.',
    `- Use apenas vocabulário e estruturas adequadas ao nível ${student.level}.`,
    '- Você NÃO controla o fluxo da aula: o sistema decide repetir/avançar. Apenas responda no formato JSON pedido.',
    '',
    `Estilo de ensino: ${STYLE[student.teaching_style] || STYLE.balanced}`,
  ].join('\n');
}

function studentContext(student, extra = {}) {
  const lines = [
    `Nível: ${student.level}`,
    `Objetivo: ${GOALS[student.goal] || student.goal}`,
  ];
  if (student.interests?.length) lines.push(`Interesses: ${student.interests.join(', ')}`);
  if (extra.weaknesses?.length) lines.push(`Dificuldades recorrentes: ${extra.weaknesses.join('; ')}`);
  if (extra.memories?.facts?.length) lines.push(`O que você já sabe sobre o aluno (de aulas anteriores): ${extra.memories.facts.join('; ')}`);
  if (extra.memories?.sessions?.length) lines.push(`Últimas conversas: ${extra.memories.sessions.join(' | ')}`);
  return lines.join('\n');
}

function lessonPlanPrompt({ lang, student, skill, topic, difficulty, count, reviewErrors }) {
  return `${studentContext(student, { weaknesses: reviewErrors.map((e) => `${e.error_type}: "${e.actual}" → "${e.expected}"`) })}

TAREFA: preparar uma mini-aula prática.
Habilidade-alvo: ${skill.name} (${skill.cefr_level}) — ${skill.description || ''}
Tema da conversa: ${topic}
Dificuldade inicial: ${difficulty}/5 (1 = frases curtas guiadas, 5 = respostas longas e abertas)
${reviewErrors.length ? `Inclua prática que revise estes erros antigos: ${reviewErrors.map((e) => `"${e.actual}" (correto: "${e.expected}")`).join(', ')}` : ''}

Gere ${count} itens em ordem crescente de dificuldade. Cada item é uma pergunta ou tarefa curta em ${lang.name}, dentro do tema, que obrigue o aluno a PRODUZIR uma frase usando a habilidade-alvo.
- "prompt": a pergunta/tarefa em ${lang.name}, como o professor falaria.
- "instructionPt": instrução curta em português só se ajudar (ex.: "Responda usando o passado."), senão null. NUNCA revele a forma correta do verbo/palavra que o aluno precisa produzir.
- O "prompt" também não pode entregar a resposta (nada de "Answer with: I went to...").
- "modelAnswer": uma resposta-modelo correta e natural no nível do aluno.
- "difficulty": 1 a 5.

Também gere "introTarget" (1–2 frases de boas-vindas em ${lang.name}, apresentando o tema) e "introPt" (1–2 frases em português dizendo o que vamos praticar hoje e por quê).

Responda SOMENTE com JSON:
{"introTarget": string, "introPt": string, "items": [{"prompt": string, "instructionPt": string|null, "modelAnswer": string, "difficulty": number}]}`;
}

function evaluationPrompt({ lang, student, skill, item, answer, attempt }) {
  return `${studentContext(student)}
Habilidade-alvo: ${skill.name}
Pergunta do professor: "${item.prompt}"
${item.instruction_pt ? `Instrução: ${item.instruction_pt}` : ''}
Resposta-modelo (referência, outras respostas corretas são válidas): "${item.model_answer}"
Tentativa nº ${attempt}
Resposta do aluno: """${answer}"""

TAREFA: avaliar a resposta do aluno.
- "offTopic": true só se o aluno fugiu totalmente da aula (pediu outra coisa, falou de outro assunto sem tentar responder). Nesse caso, "redirectTarget" deve trazer o assunto de volta para a prática em ${lang.name}, de forma gentil, terminando com a pergunta original reformulada.
- "isCorrect": true se a resposta é gramaticalmente aceitável e usa a habilidade-alvo. Ela não precisa responder exatamente o que foi perguntado: um desvio leve de assunto é aceitável (comente-o em "feedbackTarget"). Erros só de digitação ("typo") ou "minor" NÃO tornam a resposta incorreta.
- Se a frase estiver correta mas NÃO usar a habilidade-alvo, "isCorrect" = false, "errors" = [] e a dica deve pedir para usar a estrutura.
- "errors": SOMENTE erros linguísticos (gramática, vocabulário, ortografia, ordem) — nunca "não respondeu à pergunta". Cada erro com "type" (código em MAIÚSCULAS, ex.: PAST_SIMPLE, VERB_TO_BE, PREPOSITION, WORD_ORDER, ARTICLE, SPELLING), "original" (trecho errado), "corrected" (trecho corrigido) e "severity": critical (impede compreensão ou é o alvo da aula), relevant, minor, typo.
- "correctedSentence": a frase completa do aluno corrigida (null se já estava correta).
- "feedbackTarget": reação curta em ${lang.name}, SEM elogio genérico no início (o sistema já adiciona "Great!" etc.). Se correto: comentário natural sobre o conteúdo da resposta. Se incorreto: reação gentil ("Almost!") sem dar a resposta.
- "explanationPt": explicação curta da REGRA em português, SEM revelar a palavra/frase correta deste item (ex.: "Você está falando do passado (last year), então o verbo precisa ir para o passado — e 'go' é irregular."). null se correto.
- "alternativeExplanationPt": a mesma regra explicada de OUTRO jeito, com um exemplo usando OUTRO verbo/palavra, em português.
- "hint1": dica em ${lang.name} que leve o aluno a perceber o erro SEM revelar a resposta (ex.: "After 'didn't', what form does the verb use?").
- "hint2": dica mais direta, em português (ex.: "Use a forma base do verbo.").
- "partialAnswer": só o começo da frase correta, para o aluno completar (ex.: "I didn't ...").
- "phonetic": transcrição IPA da frase correta somente se houver palavra com pronúncia difícil para brasileiros; senão null.
- "newVocabulary": até 2 palavras úteis que apareceram e que um aluno ${student.level} provavelmente ainda não domina (palavra em ${lang.name} na forma de dicionário — verbo no infinitivo, substantivo no singular — + tradução), ou []. Não inclua palavras básicas.

Responda SOMENTE com JSON:
{"offTopic": boolean, "redirectTarget": string|null, "isCorrect": boolean, "errors": [{"type": string, "original": string, "corrected": string, "severity": "critical"|"relevant"|"minor"|"typo"}], "correctedSentence": string|null, "feedbackTarget": string, "explanationPt": string|null, "alternativeExplanationPt": string|null, "hint1": string|null, "hint2": string|null, "partialAnswer": string|null, "phonetic": string|null, "newVocabulary": [{"word": string, "translation": string}]}`;
}

function summaryPrompt({ student, skill, stats, errors }) {
  return `${studentContext(student)}
Aula de hoje: ${skill.name}
Acertos: ${stats.accuracy}% (${stats.correct}/${stats.total} itens), primeira tentativa: ${stats.firstTry}
Erros cometidos: ${errors.length ? errors.map((e) => `${e.type}: "${e.original}" → "${e.corrected}"`).join('; ') : 'nenhum'}

TAREFA: escreva um comentário final do professor, em português, em 2 frases: o que o aluno melhorou e o que ainda precisa praticar. Seja específico e humano.
Responda SOMENTE com JSON: {"teacherCommentPt": string}`;
}

const EVAL_FIELDS = (lang) => `- "errors": SOMENTE erros linguísticos (gramática, vocabulário, ortografia, ordem). Cada erro com "type" (código em MAIÚSCULAS — use um destes códigos de habilidade quando se aplicar: {SKILL_CODES}; senão algo como PREPOSITION, ARTICLE, SPELLING, WORD_ORDER, VOCABULARY), "original", "corrected" e "severity": critical (impede compreensão), relevant, minor, typo.
- "correctedSentence": a frase do aluno corrigida (null se já estava correta).
- "explanationPt": explicação curta da regra em português, sem entregar a frase pronta (null se correto).
- "alternativeExplanationPt": a mesma regra explicada de outro jeito, com outro exemplo.
- "hint1": dica em ${lang.name} que leve o aluno a perceber o erro sem dar a resposta.
- "hint2": dica mais direta em português.
- "partialAnswer": o começo da frase correta para o aluno completar.
- "phonetic": IPA da frase corrigida só se houver palavra difícil para brasileiros; senão null.
- "newVocabulary": até 2 palavras úteis que um aluno do nível provavelmente ainda não domina, na forma de dicionário (verbo no infinitivo, substantivo no singular), ou [].`;

const EVAL_JSON = '"offTopic": boolean, "redirectTarget": string|null, "isCorrect": boolean, "errors": [{"type": string, "original": string, "corrected": string, "severity": "critical"|"relevant"|"minor"|"typo"}], "correctedSentence": string|null, "feedbackTarget": string, "explanationPt": string|null, "alternativeExplanationPt": string|null, "hint1": string|null, "hint2": string|null, "partialAnswer": string|null, "phonetic": string|null, "newVocabulary": [{"word": string, "translation": string}]';

/** Aula do dia / palavras escolhidas / material: cada item pode estar ligado a um erro antigo, palavra ou exercício */
function dailyPlanPrompt({ lang, student, skill, topic, difficulty, reviewErrors, words, skillCount, focusPt }) {
  const blocks = [];
  const origin = (e) => (e.source === 'live' ? ' — dito pelo aluno na CONVERSA POR VOZ' : e.source === 'conversation' ? ' — escrito na conversa por texto' : '');
  if (reviewErrors.length) blocks.push(`Para CADA erro abaixo, 1 item que obrigue o aluno a produzir a forma correta (ref = "error:ID"):\n${reviewErrors.map((e) => `- ID ${e.id}: o aluno disse/escreveu "${e.actual}" (correto: "${e.expected}", tipo ${e.error_type})${origin(e)}`).join('\n')}`);
  if (reviewErrors.some((e) => ['live', 'conversation'].includes(e.source))) {
    blocks.push('IMPORTANTE: comece o "introPt" lembrando o aluno do erro da conversa (ex.: "Na nossa conversa você disse \'I go yesterday\'. Hoje vamos fixar a forma certa.") e coloque esses itens primeiro.');
  }
  if (words.length) blocks.push(`Para CADA palavra abaixo, 1 item que obrigue o aluno a USAR a palavra numa frase (ref = "vocab:ID"):\n${words.map((w) => `- ID ${w.id}: "${w.word}"${w.translation ? ` (${w.translation})` : ''}`).join('\n')}`);
  if (skillCount) blocks.push(`Depois, ${skillCount} itens praticando a habilidade ${skill.name} (${skill.cefr_level}) — ${skill.description || ''} (ref = null).`);
  return `${studentContext(student)}

TAREFA: montar ${focusPt}.
Tema da conversa: ${topic}. Dificuldade: ${difficulty}/5.

${blocks.join('\n\n')}

Regras dos itens: pergunta/tarefa curta em ${lang.name} ("prompt"), "instructionPt" opcional em português que NUNCA revele a resposta, "modelAnswer" correta e natural no nível do aluno, "difficulty" 1–5, "ref" como indicado.
Também gere "introTarget" (1–2 frases em ${lang.name}) e "introPt" (1–2 frases em português explicando o que será revisado/praticado e por quê).

Responda SOMENTE com JSON:
{"introTarget": string, "introPt": string, "items": [{"prompt": string, "instructionPt": string|null, "modelAnswer": string, "difficulty": number, "ref": string|null}]}`;
}

function placementBankPrompt({ lang }) {
  return `TAREFA: criar um banco de perguntas para um TESTE DE NIVELAMENTO de ${lang.name} para um brasileiro.
Crie 3 perguntas para cada nível: A1, A2, B1 e B2 (12 no total), variando a área: "grammar", "vocabulary" e "reading".
- "prompt": em ${lang.name}. Pergunta aberta que exija uma resposta escrita curta (1–2 frases) e revele se o aluno domina o nível. Em "reading", inclua um texto curto (2–4 frases do nível) seguido de uma pergunta sobre ele.
- "instructionPt": instrução curta em português (ex.: "Responda com uma frase completa."), sem dar a resposta.
- "modelAnswer": uma resposta correta de referência.
Use temas do cotidiano. Não faça perguntas de múltipla escolha.

Responda SOMENTE com JSON:
{"questions": [{"level": "A1"|"A2"|"B1"|"B2", "area": "grammar"|"vocabulary"|"reading", "prompt": string, "instructionPt": string|null, "modelAnswer": string}]}`;
}

function placementEvalPrompt({ lang, question, answer }) {
  return `Teste de nivelamento de ${lang.name}. Pergunta (nível ${question.level}, área ${question.area}): "${question.prompt}"
Resposta de referência: "${question.modelAnswer}"
Resposta do aluno: """${answer}"""

Dê uma nota de 0 a 100 para o quanto a resposta demonstra domínio do nível ${question.level}: compreensão da pergunta, correção gramatical, vocabulário adequado e se responde ao que foi pedido.
Resposta em branco, "não sei" ou em português = 0. Erros pequenos de digitação não devem pesar.
"feedbackPt": 1 frase curta e encorajadora em português (sem corrigir em detalhe).
Responda SOMENTE com JSON: {"score": number, "feedbackPt": string}`;
}

function conversationOpeningPrompt({ lang, student, mode, topic, scenario, memories }) {
  const what = mode === 'roleplay'
    ? `ROLEPLAY. Você interpreta: ${scenario.role}. Objetivo do aluno: ${scenario.goalPt}. Abra a cena em ${lang.name} já no personagem (ex.: "Good evening. Welcome to our hotel. How can I help you?").`
    : `CONVERSA LIVRE sobre o tema "${topic}". Abra com uma pergunta pessoal e interessante em ${lang.name}, adequada ao nível.`;
  return `${studentContext(student, { memories })}
${memories?.sessions?.length && mode !== 'roleplay' ? 'Se fizer sentido, retome algo da última conversa ou um fato que o aluno contou (como um professor que lembra dele).' : ''}

TAREFA: ${what}
- "openingTarget": sua primeira fala em ${lang.name} (1–3 frases curtas, terminando com uma pergunta).
- "contextPt": 1–2 frases em português explicando ao aluno a situação e o que ele deve tentar fazer.
Responda SOMENTE com JSON: {"openingTarget": string, "contextPt": string}`;
}

function conversationTurnPrompt({ lang, student, mode, topic, scenario, history, answer, turn, targetTurns, skillCodes, memories }) {
  const role = mode === 'roleplay'
    ? `ROLEPLAY: você interpreta ${scenario.role}. Objetivo do aluno: ${scenario.goalPt}. Não saia do personagem em "replyTarget" (as correções vão em campos separados).`
    : `CONVERSA LIVRE sobre "${topic}". Conduza a conversa: comente o que o aluno disse e faça uma nova pergunta. Aumente a complexidade aos poucos.`;
  return `${studentContext(student, { memories })}
${role}
Turno ${turn} de ${targetTurns}.

Histórico recente:
${history.map((m) => `${m.role === 'student' ? 'ALUNO' : 'VOCÊ'}: ${m.content}`).join('\n')}
ALUNO (agora): """${answer}"""

TAREFA: avaliar SOMENTE a fala atual do aluno (ALUNO agora) E continuar a conversa. Erros de falas anteriores já foram tratados: não repita correções antigas; se o aluno corrigiu um erro anterior, isso é um acerto.
- "offTopic": true só se o aluno pediu algo fora do aprendizado ou escreveu em português sem tentar ${lang.name}. Nesse caso "redirectTarget" traz a conversa de volta usando o assunto dele como tema.
- "isCorrect": true se a frase é compreensível e gramaticalmente aceitável no nível (erros "minor"/"typo" não contam).
${EVAL_FIELDS(lang).replace('{SKILL_CODES}', skillCodes.join(', '))}
- "feedbackTarget": reação curta em ${lang.name} ao erro, ou "" se a fala estiver correta. Sem elogio genérico.
- "replyTarget": sua próxima fala em ${lang.name}, natural, 1–3 frases, terminando com pergunta (exceto se a cena terminou).
- "scenarioComplete": ${mode === 'roleplay' ? 'true quando o objetivo do aluno foi cumprido e a cena chegou a um fim natural' : 'false'}.
${turn >= targetTurns ? `Este é o último turno: em "replyTarget" encerre a conversa de forma natural${mode === 'roleplay' ? ', ainda no personagem' : ''}.` : ''}

Responda SOMENTE com JSON: {${EVAL_JSON}, "replyTarget": string, "scenarioComplete": boolean}`;
}

function finalReportPrompt({ lang, student, mode, topic, scenario, transcript, errors, spoken }) {
  return `${studentContext(student)}
Avalie a ${scenario ? `cena de roleplay (${scenario.namePt}: ${scenario.goalPt})` : `conversa sobre "${topic}"`} em ${lang.name}.
${spoken ? 'A conversa foi FALADA: a transcrição do aluno vem de reconhecimento de voz, então ignore pontuação, maiúsculas e pequenas falhas de transcrição.' : ''}

Transcrição:
${transcript.map((m) => `${m.role === 'student' ? 'ALUNO' : 'PROFESSOR'}: ${m.content}`).join('\n')}

Erros registrados: ${errors.length ? errors.map((e) => `"${e.original}" → "${e.corrected}"`).join('; ') : 'nenhum'}

Dê notas de 0 a 100 considerando o nível ${student.level}: "grammar", "vocabulary", "adequacy" (adequação à situação/registro) e "fluency" (naturalidade, frases completas, conectores).
"commentPt": 2–3 frases em português, específicas e humanas: o que foi bem e o que praticar.
"betterSentences": até 3 frases do aluno reescritas de forma mais natural (original → better), ou [].
${spoken ? `"newVocabulary": até 5 palavras/expressões úteis que apareceram na conversa e que o aluno deveria guardar (forma de dicionário + tradução).` : '"newVocabulary": [].'}
${scenario ? '"memories": [] (roleplay é ficção). "sessionSummaryPt": 1 frase sobre a cena praticada.' : `"memories": até 5 FATOS REAIS e duradouros que o aluno contou sobre a vida dele (trabalho, família, gostos, planos, viagens, rotina), em português, curtos e na 3ª pessoa (ex.: "Trabalha como programador", "Vai viajar para Orlando em dezembro"). Não invente; se não houver, [].
"sessionSummaryPt": 1–2 frases em português sobre o que conversaram hoje (assuntos e o que o aluno contou), para o professor retomar na próxima aula.`}
Responda SOMENTE com JSON: {"scores": {"grammar": number, "vocabulary": number, "adequacy": number, "fluency": number}, "commentPt": string, "betterSentences": [{"original": string, "better": string}], "newVocabulary": [{"word": string, "translation": string}], "memories": [string], "sessionSummaryPt": string}`;
}

function vocabEnrichPrompt({ lang, word, level }) {
  return `Palavra/expressão em ${lang.name} que um aluno brasileiro (${level}) quer estudar: "${word}".
Se houver erro de digitação, corrija em "word".
- "translation": tradução em português (as mais comuns, separadas por vírgula).
- "meaning": significado/uso em português, curto.
- "examples": 2 frases de exemplo simples em ${lang.name} no nível do aluno.
- "pronunciation": IPA.
- "level": nível CEFR estimado da palavra (A1–C1).
Responda SOMENTE com JSON: {"word": string, "translation": string, "meaning": string|null, "examples": [string], "pronunciation": string|null, "level": string|null}`;
}

function materialPrompt({ lang, student, skillCodes }) {
  return `${studentContext(student)}
O aluno enviou uma foto/PDF de um material de ${lang.name} (exercício de apostila, prova, folha de atividades…).

TAREFA:
- "readable": false se a imagem não tiver conteúdo de ${lang.name} legível.
- "titlePt": título curto do conteúdo, em português.
- "summaryPt": o que o material pratica, em 1–3 frases em português.
- "reviewPt": uma revisão do conteúdo para o aluno estudar ANTES de resolver: regra explicada em português, com 3–5 exemplos em ${lang.name}. Use quebras de linha.
- "skillCode": o código da habilidade principal, escolhido desta lista: ${skillCodes.join(', ')}; ou null.
- "exercises": transcreva os exercícios encontrados (até 12), um item por questão: "instruction" (enunciado), "question" (a frase/pergunta a resolver, com lacuna "___" se houver), "options" (alternativas, se houver) e "answer" (a resposta correta — ela NÃO será mostrada ao aluno, serve para a correção).
Responda SOMENTE com JSON: {"readable": boolean, "titlePt": string, "summaryPt": string, "reviewPt": string, "skillCode": string|null, "exercises": [{"instruction": string, "question": string, "options": [string], "answer": string}]}`;
}

function pronunciationPrompt({ lang, text, module }) {
  return `Áudio anexado: um aluno brasileiro lendo em voz alta a frase em ${lang.name}: "${text}".
${module ? `Foco da prática: ${module.title} ${module.ipa}.` : ''}
TAREFA: avaliar a pronúncia.
- "transcript": o que você realmente ouviu (transcrição literal, sem corrigir).
- "score": 0–100 para inteligibilidade e precisão dos sons (100 = nativo claro; 70 = compreensível com sotaque; 40 = difícil de entender). Se o áudio estiver vazio, mudo ou for outra frase, score baixo.
- "words": cada palavra da frase-alvo, com "ok" e, se não ok, "issuePt" curto em português (ex.: "o TH saiu como F").
- "feedbackTarget": reação curta em ${lang.name}, dizendo qual palavra repetir se houver (ex.: "Try saying 'yesterday' again.").
- "tipPt": uma dica prática em português para o principal problema, ou null.
Responda SOMENTE com JSON: {"transcript": string, "score": number, "words": [{"word": string, "ok": boolean, "issuePt": string|null}], "feedbackTarget": string, "tipPt": string|null}`;
}

const LIVE_STYLE = {
  friendly: 'Corrija só erros que atrapalham o entendimento ou que são o foco do aluno. Mantenha o clima leve.',
  balanced: 'Corrija erros relevantes de gramática e vocabulário. Para erros importantes, peça para o aluno repetir a frase certa.',
  strict: 'Corrija também erros menores e peça para repetir a frase certa com frequência.',
};

/** System prompt da aula de conversação por voz (Gemini Live) */
function liveSystem({ lang, student, topic, scenario, weaknesses, skillCodes, history, memories }) {
  return [
    persona(lang, student),
    `Esta é uma AULA DE CONVERSAÇÃO POR VOZ, ao vivo, em ${lang.name}, com um aluno brasileiro.`,
    student.name ? `Nome do aluno: ${student.name.split(' ')[0]}.` : '',
    studentContext(student, { weaknesses, memories }),
    memories?.facts?.length || memories?.sessions?.length
      ? '- MEMÓRIA: use o que você sabe do aluno de forma natural, como um professor que lembra dele (ex.: perguntar como foi algo que ele contou na última aula). Não liste tudo de uma vez.'
      : '',
    scenario
      ? `ROLEPLAY: você interpreta ${scenario.role}. Objetivo do aluno: ${scenario.goalPt}. Fique no personagem; só saia dele rapidamente para ensinar.`
      : `Tema da conversa: ${topic}. Mantenha sua personalidade de professor ao conduzir a conversa com perguntas pessoais e interessantes, aprofundando aos poucos.`,
    '',
    'IDIOMAS DA AULA (MUITO IMPORTANTE):',
    `- Esta é uma aula de conversação em ${lang.name} dada por um professor brasileiro bilíngue. A PRÁTICA é em ${lang.name}; as EXPLICAÇÕES são em PORTUGUÊS DO BRASIL.`,
    `- Em ${lang.name}: cumprimentos, perguntas da conversa, frases-modelo e tudo que o aluno deve repetir.`,
    '- Em português: explicar o que vamos fazer, explicar regras e significados, explicar correções, dar dicas de pronúncia, instruções ("agora repita comigo", "tente responder em inglês") e ajudar quando o aluno não entender.',
    `- Ao fazer uma pergunta em ${lang.name}, ${['A1', 'A2'].includes(student.level) ? 'dê logo em seguida uma ajuda curta em português (tradução ou dica de como responder)' : 'só traduza ou explique em português se o aluno não entender'}.`,
    `- Troque de idioma de forma natural e clara, sem misturar os dois na mesma frase. Fale ${lang.name} com pronúncia nativa e português com sotaque brasileiro natural.`,
    '',
    'COMO FALAR:',
    '- Frases curtas (1 a 3 por vez) e UMA pergunta por vez.',
    `- Adapte velocidade e vocabulário ao nível ${student.level}: ${['A1', 'A2'].includes(student.level) ? 'fale devagar, com palavras simples e frequentes' : 'fale em ritmo natural'}.`,
    `- Deixe o aluno falar mais do que você. Incentive-o a responder em ${lang.name}. Reaja ao que ele disse antes de perguntar outra coisa.`,
    `- Se o aluno falar em português ou travar, ajude em português e mostre como seria em ${lang.name}; depois peça para ele repetir.`,
    '- Se o aluno ficar em silêncio ou não entender, reformule com palavras mais simples.',
    '- Você é sempre o professor. Se o aluno pedir algo fora do aprendizado, use o assunto como tema para praticar.',
    '',
    'CORREÇÕES:',
    `- ${LIVE_STYLE[student.teaching_style] || LIVE_STYLE.balanced}`,
    '- Quando o aluno cometer um erro de gramática ou vocabulário que valha corrigir, CHAME a função show_correction (ela mostra um cartão na tela do aluno) e, pela voz, corrija em português e mostre a forma certa em inglês (ex.: "Quase! Como foi ontem, usamos o passado: I went to the cinema. Repete comigo: I went to the cinema."). Depois continue a conversa no idioma estudado.',
    '- Não corrija sotaque nem pequenas falhas de transcrição. Não corrija a mesma coisa duas vezes seguidas.',
    '',
    'MODO FONÉTICO:',
    '- Se o aluno pedir ajuda, perguntar como se diz algo, disser que não consegue falar uma frase ou travar tentando, CHAME show_phrase LOGO NO INÍCIO da sua resposta, antes de falar (o cartão precisa aparecer enquanto você explica), com a frase (divida frases longas em partes e chame uma vez por parte), tradução, IPA e a pronúncia aproximada para brasileiros (br).',
    '- Depois, pela voz, explique em português o som difícil, fale a frase DEVAGAR e bem articulada e peça para o aluno repetir. Elogie quando ele conseguir.',
    `- Em error_type use, quando se aplicar, um destes códigos: ${skillCodes.join(', ')}; senão PREPOSITION, ARTICLE, VOCABULARY, WORD_ORDER.`,
    history?.length ? `\nA aula já começou. Últimas falas:\n${history.map((m) => `${m.role === 'student' ? 'ALUNO' : 'VOCÊ'}: ${m.content}`).join('\n')}\nContinue de onde parou.` : '',
  ].join('\n');
}

const PHRASE_RULES = (lang) => `- "phrases": TODA frase ou palavra em ${lang.name} que o aluno vá aprender, dizer ou praticar vai aqui (não repita a lista inteira no "reply"). Cada item:
  "text" (em ${lang.name}), "translation" (português), "ipa" (transcrição IPA), "br" (pronúncia aproximada escrita do jeito que um brasileiro leria, com a sílaba tônica em MAIÚSCULAS e hífens entre sílabas — ex.: "ai UÉNT tu dhe DJIM"; para sons que não existem em português, use uma pista entre parênteses, ex.: "th (língua entre os dentes)"), "tip" (dica curta de pronúncia ou uso, opcional).`;

/** Chat livre com o professor (texto + imagens) */
function tutorPrompt({ lang, student, history, text, hasImage, memories }) {
  return `${studentContext(student, { memories })}

Você está num CHAT LIVRE com o aluno, como um professor particular de ${lang.name} disponível para qualquer dúvida: traduzir, explicar gramática, corrigir um texto, montar frases para uma situação (viagem, trabalho, um encontro…), ensinar frases sobre qualquer tema, explicar uma imagem (foto de livro, placa, cardápio, print, exercício) etc.
- Responda em português do Brasil, claro e direto, em "reply" (pode usar **negrito** e listas com "- "). Exemplos sempre em ${lang.name}.
- Adapte ao nível ${student.level}. Seja prático: o aluno quer conseguir USAR o idioma.
- Se o aluno pedir algo sem relação com idiomas, ajude a transformar aquilo em prática de ${lang.name}.
- Se ele mandar um texto dele, mostre o que estava errado e a versão correta.
${hasImage ? `- O aluno enviou uma IMAGEM: leia o que há nela e responda ao pedido dele sobre ela (se ele não disse nada, explique o conteúdo em ${lang.name} que aparece e ensine as frases úteis).` : ''}
- MODO FONÉTICO: se o aluno disser que não consegue falar/pronunciar, pedir ajuda, ou perguntar "como se fala/diz…", foque em ensinar a falar: divida frases longas em partes curtas em "phrases", com a pronúncia aproximada e dicas dos sons difíceis para brasileiros.
${PHRASE_RULES(lang)}
- Termine o "reply", quando fizer sentido, com uma sugestão curta do que praticar a seguir.
- Só se apresente (nome) na primeira mensagem da conversa; depois vá direto ao ponto.

Conversa até agora:
${history.map((m) => `${m.role === 'student' ? 'ALUNO' : 'PROFESSOR'}: ${m.content}`).join('\n') || '(início)'}
ALUNO (agora): """${text || '(enviou uma imagem)'}"""

Responda SOMENTE com JSON: {"reply": string, "phrases": [{"text": string, "translation": string, "ipa": string|null, "br": string|null, "tip": string|null}]}`;
}

function translatePrompt({ lang, text }) {
  return `Fala de um professor numa aula de ${lang.name} para brasileiros (mistura ${lang.name} e português):
"""${text}"""

Traduza para português do Brasil SOMENTE as partes em ${lang.name}, de forma natural e curta, mantendo a ordem. Ignore o que já está em português.
Se não houver nada em ${lang.name}, retorne "pt": "".
Responda SOMENTE com JSON: {"pt": string}`;
}

module.exports = {
  translatePrompt,
  tutorPrompt, PHRASE_RULES,
  liveSystem,
  teacherSystem, lessonPlanPrompt, evaluationPrompt, summaryPrompt, dailyPlanPrompt, placementBankPrompt, placementEvalPrompt,
  conversationOpeningPrompt, conversationTurnPrompt, finalReportPrompt, vocabEnrichPrompt, materialPrompt, pronunciationPrompt,
};
