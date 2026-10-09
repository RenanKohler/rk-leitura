import "server-only";

import { z } from "zod";
import { aiParse, AiUnavailable, type AiMessages } from "@/lib/ai";
import {
  cardsPrompt,
  cleanCards,
  MAX_CARD_ANSWER_CHARS,
  MAX_CARD_PROMPT_CHARS,
  MAX_CARDS,
  type CardHighlight,
  type HighlightCardDraft,
} from "@/lib/highlight-cards";

/**
 * Cartoes de pergunta e resposta a partir dos destaques (US-150).
 *
 * Uma chamada por texto. Vai so o que o leitor destacou e anotou, como na
 * sintese (US-140): nunca o texto inteiro.
 */

export const CARDS_MESSAGES: AiMessages = {
  notConfigured: "Os cartões não estão disponíveis nesta instalação.",
  refusal: "Não consigo criar cartões com estes destaques.",
  failure: "Não consegui criar os cartões agora. Tente de novo.",
};

const CardsSchema = z.object({
  cards: z
    .array(
      z.object({
        highlight: z.number().int().describe("Número do destaque de origem, como na lista."),
        prompt: z
          .string()
          .describe(
            `Pergunta curta, em português do Brasil, de até ${MAX_CARD_PROMPT_CHARS} caracteres.`
          ),
        answer: z
          .string()
          .describe(`Resposta curta, de até ${MAX_CARD_ANSWER_CHARS} caracteres.`),
      })
    )
    .max(MAX_CARDS),
});

const SYSTEM = [
  "Você cria cartões de revisão espaçada, em português do Brasil, a partir dos trechos que um leitor destacou.",
  "No máximo um cartão por destaque, indicando o número do destaque de origem.",
  "A pergunta pede a ideia central do trecho, não um detalhe decorativo, e não copia a resposta.",
  "A pergunta e a resposta usam só o que está no trecho destacado e na nota do leitor; nada do resto do texto nem de conhecimento externo.",
  "A nota é a opinião do leitor e indica o que ele achou importante no trecho.",
  "Um destaque sem ideia que dê pergunta (só um nome, uma frase solta) fica sem cartão.",
].join(" ");

export async function generateHighlightCards(
  userId: string,
  textId: string,
  title: string,
  items: CardHighlight[]
): Promise<HighlightCardDraft[]> {
  const { prompt, ids, words } = cardsPrompt(title, items);
  const parsed = await aiParse({
    task: "cartoes",
    userId,
    textId,
    wordsSent: words,
    messages: CARDS_MESSAGES,
    schema: CardsSchema,
    system: SYSTEM,
    maxTokens: 6000,
    effort: "medium",
    content: [{ role: "user", content: prompt }],
    timeoutMs: 50_000,
  });

  const cards = cleanCards(parsed, ids);
  if (cards.length === 0) throw new AiUnavailable(CARDS_MESSAGES.failure);
  return cards;
}
