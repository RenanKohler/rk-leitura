import "server-only";

import { z } from "zod";
import { aiParse, countWords, type AiMessages } from "@/lib/ai";
import { MAX_SUGGESTION_WORDS, MAX_SUGGESTIONS, parseSuggestions } from "@/lib/ask";
import { DEFAULT_LANGUAGE, languageName } from "@/lib/language";

/**
 * Perguntas sugeridas ao abrir "Perguntar ao texto" (US-148). O recorte ja
 * chega cortado (`suggestionCut` e `askExcerpt`): nada depois da posicao de
 * leitura sai do app.
 */

const MESSAGES: AiMessages = {
  notConfigured: "As sugestões não estão configuradas nesta instalação.",
  refusal: "Sem sugestões para este trecho.",
  failure: "Sem sugestões agora.",
};

const Schema = z.object({
  questions: z
    .array(z.string())
    .describe(
      `Até ${MAX_SUGGESTIONS} perguntas em português, cada uma com no máximo ${MAX_SUGGESTION_WORDS} palavras.`
    ),
});

function system(language: string): string {
  const lines = [
    "Você sugere perguntas que ajudam quem está lendo a entender melhor o trecho que já leu.",
    "O trecho termina onde a leitura parou: não suponha nem antecipe o que vem depois.",
    `Sugira até ${MAX_SUGGESTIONS} perguntas curtas, diferentes entre si, que o próprio trecho responde, cada uma com no máximo ${MAX_SUGGESTION_WORDS} palavras, em português do Brasil.`,
  ];
  if (language !== DEFAULT_LANGUAGE) {
    lines.push(`O trecho está em ${languageName(language).toLowerCase()}; as perguntas são em português.`);
  }
  return lines.join(" ");
}

export async function suggestQuestions(
  userId: string,
  textId: string,
  title: string,
  excerpt: string,
  language: string
): Promise<string[]> {
  const parsed = await aiParse({
    task: "sugestoes",
    userId,
    textId,
    wordsSent: countWords(excerpt),
    messages: MESSAGES,
    schema: Schema,
    system: system(language),
    // No Haiku o raciocinio conta no teto: folga para ele e a lista curta.
    maxTokens: 1500,
    effort: "low",
    timeoutMs: 20_000,
    content: [{ role: "user", content: `Título: ${title}\n\nTrecho lido:\n\n${excerpt}` }],
  });
  return parseSuggestions(parsed);
}
