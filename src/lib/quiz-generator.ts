import "server-only";

import { z } from "zod";
import { aiParse, AiUnavailable, countWords, type AiMessages } from "@/lib/ai";
import { DEFAULT_LANGUAGE, languageName } from "@/lib/language";
import {
  CHOICES_PER_QUESTION,
  MAX_QUESTIONS,
  MAX_RATIONALE_WORDS,
  MIN_QUESTIONS,
  parseQuiz,
  quizSample,
  type Quiz,
} from "@/lib/quiz";
import { SESSION_CHECK_QUESTIONS } from "@/lib/session-check";

/**
 * Geracao das perguntas de compreensao. O envio ao modelo, a chave e o
 * tratamento de erro ficam em `lib/ai.ts` (US-123).
 */

const MESSAGES: AiMessages = {
  notConfigured: "O questionário não está configurado nesta instalação.",
  refusal: "Não consigo montar perguntas sobre este texto.",
  failure: "Não consegui montar o questionário agora.",
};

const QuestionSchema = z.object({
  prompt: z.string().describe("A pergunta, em português do Brasil."),
  choices: z
    .array(z.string())
    .length(CHOICES_PER_QUESTION)
    .describe("Alternativas plausíveis; apenas uma correta."),
  answer: z.number().int().describe("Índice da alternativa correta, começando em zero."),
  evidence: z
    .string()
    .describe("Trecho curto copiado do texto que justifica a resposta correta."),
  // Mesma chamada, cerca de 60 tokens a mais por pergunta (US-135).
  rationale: z
    .string()
    .describe(
      `Por que a alternativa correta está certa e as outras não, em até ${MAX_RATIONALE_WORDS} palavras, em português do Brasil.`
    ),
});

const QuizSchema = z.object({
  questions: z.array(QuestionSchema).min(MIN_QUESTIONS).max(MAX_QUESTIONS),
});

// Checagem da sessao (US-149): o mesmo formato, com exatamente duas perguntas.
const SessionQuizSchema = z.object({
  questions: z.array(QuestionSchema).min(SESSION_CHECK_QUESTIONS).max(SESSION_CHECK_QUESTIONS),
});

const SYSTEM = [
  "Você escreve perguntas de compreensão de leitura em português do Brasil.",
  "As perguntas verificam se quem leu entendeu o conteúdo, não se decorou detalhes irrelevantes.",
  "Cada pergunta tem exatamente quatro alternativas e uma única correta.",
  "As alternativas erradas são plausíveis para quem leu por cima, nunca absurdas.",
  "A evidência é um trecho curto copiado do texto, sem paráfrase.",
  `A justificativa explica, em até ${MAX_RATIONALE_WORDS} palavras, por que a correta está certa, sem repetir o enunciado.`,
  "Nunca faça perguntas que possam ser respondidas sem ler o texto.",
].join(" ");

/** Pedido em outro idioma (US-69): perguntas em portugues, citacoes no original. */
function languageNoteFor(language: string): string {
  return language === DEFAULT_LANGUAGE
    ? ""
    : `\n\nO texto está em ${languageName(language).toLowerCase()}. Escreva perguntas e alternativas em português do Brasil; quando citar o texto, inclusive na evidência, mantenha a citação no idioma original.`;
}

export async function generateQuiz(
  userId: string,
  title: string,
  content: string,
  language: string = DEFAULT_LANGUAGE,
  textId?: string
): Promise<Quiz> {
  // Texto longo vai em trechos do comeco ao fim, nao so o comeco (US-133).
  const sample = quizSample(content);
  const sampleNote =
    sample.blocks.length > 0
      ? `\n\nO texto é longo: seguem ${sample.blocks.length} trechos, na ordem, distribuídos do começo ao fim. Distribua as perguntas pelo texto inteiro, não só pelo começo.`
      : "";
  const languageNote = languageNoteFor(language);

  const parsed = await aiParse({
    task: "questionario",
    userId,
    textId,
    wordsSent: countWords(sample.text),
    messages: MESSAGES,
    schema: QuizSchema,
    system: SYSTEM,
    maxTokens: 8000,
    // `medium` e o padrao deste modelo; fica explicito para nao mudar sem aviso.
    effort: "medium",
    content: [
      {
        role: "user",
        content: `Título: ${title}${sampleNote}\n\nTexto:\n${sample.text}\n\nEscreva de ${MIN_QUESTIONS} a ${MAX_QUESTIONS} perguntas de compreensão sobre este texto.${languageNote}`,
      },
    ],
  });

  // `parsed` vem null quando a resposta nao casou com o formato. A validacao
  // propria roda de qualquer jeito: e ela que garante que a tela nunca receba
  // uma pergunta impossivel de responder.
  const quiz = parseQuiz(parsed);
  if (!quiz) throw new AiUnavailable(MESSAGES.failure);

  return quiz;
}

/**
 * Duas perguntas sobre o trecho lido numa sessao do Word Runner (US-149).
 *
 * `excerpt` ja vem recortado por `sessionExcerpt`: so as palavras entre o
 * inicio da sessao e a posicao atual. As perguntas nao podem depender do que
 * vem depois - o leitor ainda nao leu, e o modelo nem recebe.
 */
export async function generateSessionQuiz(
  userId: string,
  title: string,
  excerpt: string,
  language: string = DEFAULT_LANGUAGE,
  textId?: string
): Promise<Quiz> {
  // Sessao muito longa vai em trechos, como o texto inteiro (US-133).
  const sample = quizSample(excerpt);
  const sampleNote =
    sample.blocks.length > 0
      ? `\n\nO trecho é longo: seguem ${sample.blocks.length} partes, na ordem, do começo ao fim do que foi lido.`
      : "";

  const parsed = await aiParse({
    task: "questionario",
    userId,
    textId,
    wordsSent: countWords(sample.text),
    messages: MESSAGES,
    schema: SessionQuizSchema,
    system: SYSTEM,
    maxTokens: 4000,
    effort: "medium",
    content: [
      {
        role: "user",
        content: `Título: ${title}${sampleNote}\n\nTrecho lido nesta sessão (o leitor ainda não leu o resto do texto):\n${sample.text}\n\nEscreva exatamente ${SESSION_CHECK_QUESTIONS} perguntas de compreensão sobre este trecho. Não pergunte nada que dependa de partes do texto que não estão aqui.${languageNoteFor(language)}`,
      },
    ],
  });

  const quiz = parseQuiz(parsed, SESSION_CHECK_QUESTIONS, SESSION_CHECK_QUESTIONS);
  if (!quiz) throw new AiUnavailable(MESSAGES.failure);
  return quiz;
}
