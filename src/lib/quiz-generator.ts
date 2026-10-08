import "server-only";

import { z } from "zod";
import { aiParse, AiUnavailable, type AiMessages } from "@/lib/ai";
import { DEFAULT_LANGUAGE, languageName } from "@/lib/language";
import {
  CHOICES_PER_QUESTION,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  parseQuiz,
  type Quiz,
} from "@/lib/quiz";

/**
 * Geracao das perguntas de compreensao. O envio ao modelo, a chave e o
 * tratamento de erro ficam em `lib/ai.ts` (US-123).
 */

/** Recorte enviado ao modelo. Textos longos nao melhoram as perguntas. */
const MAX_CHARS = 60_000;

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
});

const QuizSchema = z.object({
  questions: z.array(QuestionSchema).min(MIN_QUESTIONS).max(MAX_QUESTIONS),
});

const SYSTEM = [
  "Você escreve perguntas de compreensão de leitura em português do Brasil.",
  "As perguntas verificam se quem leu entendeu o conteúdo, não se decorou detalhes irrelevantes.",
  "Cada pergunta tem exatamente quatro alternativas e uma única correta.",
  "As alternativas erradas são plausíveis para quem leu por cima, nunca absurdas.",
  "A evidência é um trecho curto copiado do texto, sem paráfrase.",
  "Nunca faça perguntas que possam ser respondidas sem ler o texto.",
].join(" ");

export async function generateQuiz(
  userId: string,
  title: string,
  content: string,
  language: string = DEFAULT_LANGUAGE
): Promise<Quiz> {
  const excerpt = content.slice(0, MAX_CHARS);
  // Texto em outro idioma (US-69): perguntas em portugues, citacoes no original.
  const languageNote =
    language === DEFAULT_LANGUAGE
      ? ""
      : `\n\nO texto está em ${languageName(language).toLowerCase()}. Escreva perguntas e alternativas em português do Brasil; quando citar o texto, inclusive na evidência, mantenha a citação no idioma original.`;

  const parsed = await aiParse({
    task: "questionario",
    userId,
    messages: MESSAGES,
    schema: QuizSchema,
    system: SYSTEM,
    maxTokens: 8000,
    // `medium` e o padrao deste modelo; fica explicito para nao mudar sem aviso.
    effort: "medium",
    content: [
      {
        role: "user",
        content: `Título: ${title}\n\nTexto:\n${excerpt}\n\nEscreva de ${MIN_QUESTIONS} a ${MAX_QUESTIONS} perguntas de compreensão sobre este texto.${languageNote}`,
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
