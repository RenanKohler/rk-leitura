import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiResults } from "@/db/schema";
import { aiParse, AiUnavailable, countWords, type AiMessages } from "@/lib/ai";
import { loadAiResult, saveAiResult } from "@/lib/ai-results";
import { contentKey } from "@/lib/quiz";
import {
  clampPreview,
  isPreview,
  MAX_FOCUS_ITEMS,
  PREVIEW_QUESTIONS,
  previewExcerpt,
  type Preview,
} from "@/lib/preview";

/**
 * Previa antes de ler (US-233): gerada sob demanda, guardada por versao do
 * conteudo, no padrao da sinopse (US-138). A chave leva a impressao do
 * conteudo: editar ou continuar o texto faz a previa antiga deixar de valer.
 */

export const PREVIEW_MESSAGES: AiMessages = {
  notConfigured: "A prévia não está configurada nesta instalação.",
  refusal: "Não consigo preparar a prévia deste texto.",
  failure: "Não consegui preparar a prévia agora.",
};

const Schema = z.object({
  about: z.string().describe("Do que o texto trata, em uma frase curta, em português do Brasil."),
  focus: z
    .array(z.string().describe("Item curto: algo em que prestar atenção ao ler."))
    .describe(`Até ${MAX_FOCUS_ITEMS} itens curtos.`),
  questions: z
    .array(z.string().describe("Pergunta curta que a leitura vai responder."))
    .describe(`Exatamente ${PREVIEW_QUESTIONS} perguntas.`),
});

const SYSTEM = [
  "Você prepara uma prévia de leitura para quem vai começar um texto agora.",
  "Recebe só o começo do texto. Devolve: do que ele trata, em uma frase;",
  `até ${MAX_FOCUS_ITEMS} pontos curtos em que prestar atenção (conceitos, personagens, a tese que se anuncia);`,
  `e exatamente ${PREVIEW_QUESTIONS} perguntas curtas para ler buscando a resposta.`,
  "Tudo em português do Brasil, mesmo que o texto esteja em outro idioma.",
  "Sem spoiler: não antecipa desfecho, reviravolta nem conclusão, não responde às perguntas e não inventa o que não está no trecho.",
  "Não começa com \"Este texto\" nem repete o título.",
].join(" ");

export function previewKey(textId: string, content: string): string {
  return `${textId}:${contentKey(content)}`;
}

export async function cachedPreview(
  userId: string,
  textId: string,
  content: string
): Promise<Preview | null> {
  const stored = await loadAiResult<unknown>(userId, "previa", previewKey(textId, content));
  return isPreview(stored) ? stored : null;
}

export async function generatePreview(
  userId: string,
  textId: string,
  title: string,
  content: string
): Promise<Preview> {
  const excerpt = previewExcerpt(content);
  const parsed = await aiParse({
    task: "previa",
    userId,
    textId,
    wordsSent: countWords(excerpt),
    messages: PREVIEW_MESSAGES,
    schema: Schema,
    system: SYSTEM,
    // No Haiku o raciocinio conta no teto: folga para ele e a saida curta.
    maxTokens: 2000,
    effort: "low",
    timeoutMs: 30_000,
    content: [{ role: "user", content: `Título: ${title}\n\nComeço do texto:\n\n${excerpt}` }],
  });

  const preview = clampPreview(parsed);
  if (!preview) throw AiUnavailable.invalid(PREVIEW_MESSAGES.failure);

  const key = previewKey(textId, content);
  // A versao anterior do conteudo nao volta: a previa dela so ocuparia espaco.
  await db
    .delete(aiResults)
    .where(
      and(
        eq(aiResults.userId, userId),
        eq(aiResults.textId, textId),
        eq(aiResults.kind, "previa"),
        ne(aiResults.key, key)
      )
    );
  await saveAiResult(userId, textId, "previa", key, preview);
  return preview;
}
