// Máquina de estados da aula. Só o backend muda o estado; a IA nunca decide transições.
const S = Object.freeze({
  LESSON_STARTED: 'LESSON_STARTED',
  INTRODUCTION: 'INTRODUCTION',
  EXPLANATION: 'EXPLANATION',
  EXAMPLE: 'EXAMPLE',
  PRACTICE: 'PRACTICE',
  WAITING_FOR_ANSWER: 'WAITING_FOR_ANSWER',
  EVALUATING: 'EVALUATING',
  CORRECT: 'CORRECT',
  INCORRECT: 'INCORRECT',
  RETRY: 'RETRY',
  REINFORCEMENT: 'REINFORCEMENT',
  DIFFICULTY_REDUCTION: 'DIFFICULTY_REDUCTION',
  DIFFICULTY_INCREASE: 'DIFFICULTY_INCREASE',
  MASTERED: 'MASTERED',
  NEXT_ACTIVITY: 'NEXT_ACTIVITY',
  LESSON_COMPLETED: 'LESSON_COMPLETED',
});

const TRANSITIONS = {
  LESSON_STARTED: ['INTRODUCTION'],
  INTRODUCTION: ['EXPLANATION', 'PRACTICE'],
  EXPLANATION: ['EXAMPLE', 'PRACTICE'],
  EXAMPLE: ['PRACTICE'],
  PRACTICE: ['WAITING_FOR_ANSWER'],
  WAITING_FOR_ANSWER: ['EVALUATING', 'LESSON_COMPLETED'],
  EVALUATING: ['CORRECT', 'INCORRECT', 'WAITING_FOR_ANSWER'], // WAITING_FOR_ANSWER = fuga do tema, sem contar tentativa
  CORRECT: ['DIFFICULTY_INCREASE', 'MASTERED', 'NEXT_ACTIVITY', 'LESSON_COMPLETED'],
  DIFFICULTY_INCREASE: ['MASTERED', 'NEXT_ACTIVITY', 'LESSON_COMPLETED'],
  MASTERED: ['NEXT_ACTIVITY', 'LESSON_COMPLETED'],
  INCORRECT: ['RETRY', 'REINFORCEMENT', 'DIFFICULTY_REDUCTION', 'NEXT_ACTIVITY', 'LESSON_COMPLETED'],
  RETRY: ['WAITING_FOR_ANSWER'],
  REINFORCEMENT: ['WAITING_FOR_ANSWER'],
  DIFFICULTY_REDUCTION: ['WAITING_FOR_ANSWER'],
  NEXT_ACTIVITY: ['PRACTICE'],
  LESSON_COMPLETED: [],
};

class InvalidTransitionError extends Error {
  constructor(from, to) {
    super(`Transição inválida: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

/** Aplica uma sequência de transições a partir de `from`, validando cada passo. Retorna o caminho percorrido. */
function walk(from, ...steps) {
  const path = [];
  let cur = from;
  for (const next of steps) {
    if (!canTransition(cur, next)) throw new InvalidTransitionError(cur, next);
    path.push(next);
    cur = next;
  }
  return { state: cur, path };
}

module.exports = { S, TRANSITIONS, canTransition, walk, InvalidTransitionError };
