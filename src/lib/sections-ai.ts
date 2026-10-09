import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiResults } from "@/db/schema";
import { aiParse, AiUnavailable, countWords, type AiMessages } from "@/lib/ai";
import { loadAiResult, saveAiResult } from "@/lib/ai-results";
import { contentKey } from "@/lib/quiz";
import type { Paragraph } from "@/lib/reading";
import {
  MAX_SECTION_TITLE_WORDS,
  MIN_SECTIONS,
  sectionParts,
  validSections,
  type Section,
} from "@/lib/sections";

/**
 * Secoes para um documento longo sem titulos (US-153).
 *
 * Sob demanda, pelo botao em "Navegar no texto". A sugestao fica guardada
 * pela impressao do conteudo: pedir de novo o mesmo texto nao gera chamada,
 * e editar o conteudo faz a antiga deixar de ser encontrada.
 */

const MESSAGES: AiMessages = {
  notConfigured: "A sugestão de seções não está configurada nesta instalação.",
  refusal: "Não consigo dividir este texto em seções.",
  failure: "Não consegui sugerir seções agora.",
};

/** Sem pontos de divisao suficientes: o texto nao tem viradas claras. */
const TOO_FEW = "Não encontrei divisões claras neste texto.";

const TIMEOUT_MS = 50_000;

interface StoredSuggestion {
  sections: Section[];
}

const Schema = z.object({
  sections: z
    .array(
      z.object({
        paragraph: z
          .number()
          .describe("Número do parágrafo onde a seção começa, como aparece entre colchetes."),
        title: z.string().describe(`Título da seção, com até ${MAX_SECTION_TITLE_WORDS} palavras.`),
      })
    )
    .describe("Pontos de divisão, na ordem do texto."),
});

function system(maxSections: number, first: number): string {
  return [
    "Você organiza um documento longo que chegou sem títulos, para que a pessoa navegue por ele.",
    "Recebe os parágrafos numerados entre colchetes e escolhe onde começa cada seção:",
    "viradas de assunto, de cena, de etapa do argumento ou de capítulo.",
    `Escolha de 1 a ${maxSections} pontos, sempre no início de um parágrafo, e dê a cada um um título de até ${MAX_SECTION_TITLE_WORDS} palavras,`,
    "no idioma do texto, que diga o que a seção trata, sem numeração.",
    first === 0
      ? "O primeiro ponto é o parágrafo 0."
      : "Este é um trecho do meio do documento: não marque o primeiro parágrafo só por ser o primeiro.",
    "Nunca reescreve nem resume o texto; devolve só os números e os títulos.",
  ].join(" ");
}

export function sectionsKey(textId: string, content: string): string {
  return `${textId}:${contentKey(content)}`;
}

export async function cachedSections(
  userId: string,
  textId: string,
  content: string
): Promise<Section[] | null> {
  const stored = await loadAiResult<StoredSuggestion>(
    userId,
    "secoes",
    sectionsKey(textId, content)
  );
  return stored?.sections ?? null;
}

/** Pede as secoes, parte por parte, e guarda a sugestao validada. */
export async function generateSections(
  userId: string,
  textId: string,
  content: string,
  paragraphs: Paragraph[]
): Promise<Section[]> {
  const raw: unknown[] = [];
  for (const part of sectionParts(paragraphs)) {
    const parsed = await aiParse({
      task: "secoes",
      userId,
      messages: MESSAGES,
      schema: Schema,
      system: system(part.maxSections, part.first),
      maxTokens: 4000,
      effort: "low",
      timeoutMs: TIMEOUT_MS,
      textId,
      wordsSent: countWords(part.prompt),
      content: [{ role: "user", content: part.prompt }],
    });
    // Cada parte so aponta para os proprios paragrafos.
    for (const item of parsed?.sections ?? []) {
      if (item.paragraph >= part.first && item.paragraph <= part.last) raw.push(item);
    }
  }

  const sections = validSections(raw, paragraphs);
  if (sections.length < MIN_SECTIONS) throw new AiUnavailable(TOO_FEW, 422);

  const key = sectionsKey(textId, content);
  // A sugestao de uma versao anterior do conteudo nao volta a valer.
  await db
    .delete(aiResults)
    .where(
      and(
        eq(aiResults.userId, userId),
        eq(aiResults.textId, textId),
        eq(aiResults.kind, "secoes"),
        ne(aiResults.key, key)
      )
    );
  await saveAiResult(userId, textId, "secoes", key, {
    sections,
  } satisfies StoredSuggestion);
  return sections;
}
