import "server-only";

import { z } from "zod";
import { aiParse, AiUnavailable, countWords, type AiMessages } from "@/lib/ai";
import {
  cleanSynthesis,
  MAX_SYNTHESIS_WORDS,
  synthesisPrompt,
  type SynthesisHighlight,
} from "@/lib/highlight-synthesis";

/**
 * Sintese dos destaques de um texto (US-140).
 *
 * Vai so o que o leitor destacou e anotou, nunca o texto inteiro: custa menos
 * e manda menos conteudo para fora do app.
 */

export const SYNTHESIS_MESSAGES: AiMessages = {
  notConfigured: "A síntese não está disponível nesta instalação.",
  refusal: "Não consigo sintetizar estes destaques.",
  failure: "Não consegui sintetizar agora. Tente de novo.",
};

const SynthesisSchema = z.object({
  synthesis: z
    .string()
    .describe(
      `Síntese de até ${MAX_SYNTHESIS_WORDS} palavras, com o número de cada destaque usado entre colchetes, como [2].`
    ),
});

const SYSTEM = [
  "Você sintetiza, em português do Brasil, os trechos que um leitor destacou em um texto.",
  `Escreve um só parágrafo de no máximo ${MAX_SYNTHESIS_WORDS} palavras com as ideias que os destaques têm em comum e o que eles dizem juntos.`,
  "Cada afirmação indica entre colchetes o número do destaque de onde veio, como [1] ou [2][4].",
  "Usa só o que está nos destaques e nas notas do leitor; não completa com o que o texto poderia dizer.",
  "As notas são a opinião do leitor e pesam na escolha do que é importante.",
].join(" ");

export async function synthesizeHighlights(
  userId: string,
  textId: string,
  title: string,
  items: SynthesisHighlight[]
): Promise<{ synthesis: string; cited: number[] }> {
  const { prompt, included } = synthesisPrompt(title, items);
  const parsed = await aiParse({
    task: "resumo",
    userId,
    // Vai o pedido com os destaques e as notas, nao o texto: e isso que conta.
    textId,
    wordsSent: countWords(prompt),
    messages: SYNTHESIS_MESSAGES,
    schema: SynthesisSchema,
    system: SYSTEM,
    maxTokens: 4000,
    effort: "medium",
    content: [{ role: "user", content: prompt }],
    timeoutMs: 50_000,
  });

  const clean = cleanSynthesis(parsed?.synthesis, included);
  if (!clean) throw new AiUnavailable(SYNTHESIS_MESSAGES.failure);
  return clean;
}
