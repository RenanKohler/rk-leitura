import "server-only";

import { z } from "zod";
import { aiParse, AiUnavailable, countWords, type AiMessages } from "@/lib/ai";
import { DEFAULT_LANGUAGE, languageName } from "@/lib/language";
import { quizSample } from "@/lib/quiz";
import { parseParagraphs, type TextFormat } from "@/lib/reading";
import {
  CLOZE_GAP,
  cleanGeneratedCards,
  MAX_GENERATED_CARDS,
  passageIndex,
  STUDY_CARDS_MAX_CHARS,
  studyCardsPrompt,
  type StudyCardDraft,
  type StudyCardMode,
} from "@/lib/study-card-drafts";
import { MAX_CARD_SIDE_CHARS } from "@/lib/study-cards";

/**
 * Geracao dos cartoes de estudo (US-155, US-157). Uma chamada ao Sonnet por
 * pedido, sobre o texto completo: a regra de nao revelar o que vem depois
 * fica na exibicao (`splitByReading`), nao aqui. O envio, o registro e os
 * erros ficam em `lib/ai.ts`.
 */

export const STUDY_CARDS_MESSAGES: AiMessages = {
  notConfigured: "Os cartões de estudo não estão disponíveis nesta instalação.",
  refusal: "Não consigo criar cartões com este texto.",
  failure: "Não consegui criar os cartões agora. Tente de novo.",
};

export const NO_NEW_CARDS = "Nenhum cartão novo: os gerados repetiam os que você já tem.";

const QuestionSchema = z.object({
  cards: z
    .array(
      z.object({
        front: z
          .string()
          .describe(`Pergunta, em português do Brasil, de até ${MAX_CARD_SIDE_CHARS} caracteres.`),
        back: z.string().describe(`Resposta curta, de até ${MAX_CARD_SIDE_CHARS} caracteres.`),
        kind: z
          .enum(["conceito", "ponto"])
          .describe("conceito: um termo ou ideia definida no texto; ponto: um ponto principal do argumento."),
        passage: z
          .string()
          .describe("Trecho de origem copiado do texto, palavra por palavra, sem reticências."),
      })
    )
    .max(MAX_GENERATED_CARDS),
});

const ClozeSchema = z.object({
  cards: z
    .array(
      z.object({
        front: z
          .string()
          .describe(`Frase copiada do texto com um único termo-chave trocado por ${CLOZE_GAP}.`),
        back: z.string().describe("O termo escondido, exatamente como está no texto."),
      })
    )
    .max(MAX_GENERATED_CARDS),
});

const SYSTEM = [
  "Você cria cartões de memorização, para revisão espaçada, com os conceitos e os pontos principais de um texto.",
  "Os cartões cobrem o essencial do texto inteiro, não detalhes decorativos, e cada um testa uma ideia só.",
  "A pergunta não entrega a resposta. A resposta é curta e usa só o que o texto diz, sem conhecimento externo.",
  "Todo trecho copiado do texto é idêntico ao original, palavra por palavra, sem reticências nem paráfrase.",
].join(" ");

function languageNoteFor(language: string): string {
  return language === DEFAULT_LANGUAGE
    ? ""
    : `\n\nO texto está em ${languageName(language).toLowerCase()}. Escreva perguntas e respostas em português do Brasil; trechos copiados e frases de lacuna ficam no idioma original.`;
}

export async function generateStudyCards({
  userId,
  textId,
  title,
  content,
  format,
  language,
  mode,
  existingFronts,
}: {
  userId: string;
  textId: string;
  title: string;
  content: string;
  format: TextFormat;
  language: string;
  mode: StudyCardMode;
  existingFronts: string[];
}): Promise<StudyCardDraft[]> {
  // Texto acima do teto vai em trechos do comeco ao fim, como no questionario.
  const sample = quizSample(content, STUDY_CARDS_MAX_CHARS);
  const prompt = studyCardsPrompt({
    title,
    text: sample.text,
    sampled: sample.blocks.length,
    mode,
    existingFronts,
    languageNote: languageNoteFor(language),
  });

  const parsed = await aiParse({
    task: "estudo",
    userId,
    textId,
    wordsSent: countWords(sample.text),
    messages: STUDY_CARDS_MESSAGES,
    schema: mode === "lacuna" ? ClozeSchema : QuestionSchema,
    system: SYSTEM,
    maxTokens: 12_000,
    effort: "medium",
    content: [{ role: "user", content: prompt }],
    timeoutMs: 110_000,
  });

  // A validacao roda sempre: o trecho de origem e o que da a posicao, e sem
  // posicao o cartao nao tem como respeitar a regra de exibicao.
  const { words } = parseParagraphs(content, format);
  const index = passageIndex(words);
  const cards = cleanGeneratedCards(parsed, index, mode, existingFronts);
  if (cards.length > 0) return cards;
  // Tudo o que veio repetia cartoes ja salvos: diz isso, em vez de "falhou".
  const repeated = existingFronts.length > 0 && cleanGeneratedCards(parsed, index, mode).length > 0;
  throw new AiUnavailable(repeated ? NO_NEW_CARDS : STUDY_CARDS_MESSAGES.failure, repeated ? 422 : 503);
}
