import "server-only";

import { aiCreate, AiUnavailable, type AiMessages } from "@/lib/ai";
import {
  ANALOGY_FAILURE,
  analogyPrompt,
  analogyWordsSent,
  MAX_ANALOGY_WORDS,
  parseAnalogy,
  type AnalogyRequest,
} from "@/lib/analogy";

/**
 * Analogia para um cartao errado (US-168). Haiku, texto livre: a resposta e
 * curta e sem estrutura. O envio, a chave e os erros ficam em `lib/ai.ts`.
 */

export const ANALOGY_MESSAGES: AiMessages = {
  notConfigured: "A explicação não está configurada nesta instalação.",
  refusal: "Não consigo explicar este cartão de outro jeito.",
  failure: ANALOGY_FAILURE,
};

const SYSTEM = [
  "Você ajuda quem estuda a lembrar de um conceito que acabou de errar num cartão de memorização.",
  "Recebe só a frente, o verso e o trecho de origem do cartão.",
  `Responda com uma analogia ou um exemplo concreto, em no máximo ${MAX_ANALOGY_WORDS} palavras, sem título nem introdução, em português do Brasil.`,
].join(" ");

export async function generateAnalogy(
  userId: string,
  request: AnalogyRequest,
  textId: string
): Promise<string> {
  const response = await aiCreate({
    task: "analogia",
    userId,
    textId,
    wordsSent: analogyWordsSent(request),
    messages: ANALOGY_MESSAGES,
    system: SYSTEM,
    maxTokens: 1000,
    effort: "low",
    timeoutMs: 30_000,
    content: [{ role: "user", content: analogyPrompt(request) }],
  });

  const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  const analogy = parseAnalogy(text);
  if (!analogy) throw new AiUnavailable(ANALOGY_FAILURE);
  return analogy;
}
