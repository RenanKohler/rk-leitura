import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { DEFAULT_LANGUAGE, languageName } from "@/lib/language";
import {
  CHOICES_PER_QUESTION,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  parseQuiz,
  type Quiz,
} from "@/lib/quiz";

/**
 * Geracao das perguntas de compreensao.
 *
 * E a unica parte da aplicacao que envia conteudo do usuario para fora. Fica
 * isolada aqui para que esse limite seja visivel em um arquivo so, e para que
 * a ausencia da chave seja uma condicao tratada, nao uma excecao no meio de
 * uma rota.
 */

const MODEL = "claude-opus-5-5";

/** Recorte enviado ao modelo. Textos longos nao melhoram as perguntas. */
const MAX_CHARS = 60_000;

export class QuizUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuizUnavailable";
  }
}

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

/** Cliente preguicoso: sem chave configurada, a funcionalidade fica indisponivel. */
function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new QuizUnavailable("O questionário não está configurado nesta instalação.");
  }
  return new Anthropic({ apiKey });
}

export async function generateQuiz(
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

  let response;
  try {
    response = await client().beta.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      // `medium` e o padrao deste modelo; fica explicito para nao mudar sem aviso.
      output_config: { effort: "medium", format: betaZodOutputFormat(QuizSchema) },
      // Recusa dos classificadores de seguranca e refeita em outro modelo na mesma chamada.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [
        {
          role: "user",
          content: `Título: ${title}\n\nTexto:\n${excerpt}\n\nEscreva de ${MIN_QUESTIONS} a ${MAX_QUESTIONS} perguntas de compreensão sobre este texto.${languageNote}`,
        },
      ],
    });
  } catch (error) {
    if (error instanceof QuizUnavailable) throw error;
    if (error instanceof Anthropic.RateLimitError) {
      throw new QuizUnavailable("O serviço está ocupado. Tente daqui a pouco.");
    }
    if (error instanceof Anthropic.AuthenticationError) {
      throw new QuizUnavailable("O questionário não está configurado nesta instalação.");
    }
    console.error("[quiz] falha ao gerar:", error);
    throw new QuizUnavailable("Não consegui montar o questionário agora.");
  }

  // Custo por questionario: modelo que respondeu (muda quando o fallback atua) e tokens.
  console.info("[quiz] uso:", response.model, JSON.stringify(response.usage));

  // O modelo pode recusar por seguranca, e o fallback nem sempre resolve;
  // nesse caso nao ha conteudo a validar.
  if (response.stop_reason === "refusal") {
    throw new QuizUnavailable("Não consigo montar perguntas sobre este texto.");
  }

  // `parsed_output` vem null quando a resposta nao casou com o formato. A
  // validacao propria roda de qualquer jeito: e ela que garante que a tela
  // nunca receba uma pergunta impossivel de responder.
  const quiz = parseQuiz(response.parsed_output);
  if (!quiz) throw new QuizUnavailable("Não consegui montar o questionário agora.");

  return quiz;
}
