import "server-only";

import { createHash } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiResults, texts } from "@/db/schema";
import { aiParse, AiUnavailable, countWords, type AiMessages } from "@/lib/ai";
import { loadAiResult, saveAiResult } from "@/lib/ai-results";
import { contentKey } from "@/lib/quiz";
import { clampSynopsis, synopsisExcerpt } from "@/lib/synopsis";

/**
 * Sinopse sem spoiler (US-138): gerada sob demanda, guardada por versao do
 * conteudo.
 *
 * A chave leva a impressao do conteudo (`contentKey`), entao editar ou
 * continuar o texto faz a sinopse antiga deixar de ser encontrada. Para a
 * biblioteca, que lista sem carregar o conteudo, o resultado guarda tambem o
 * md5 do texto que o gerou: o banco compara com `md5(content)` na mesma
 * consulta, sem mandar o texto para o servidor da aplicacao.
 */

interface StoredSynopsis {
  synopsis: string;
  /** md5 do conteudo que gerou a sinopse, no mesmo formato do `md5()` do Postgres. */
  fingerprint: string;
}

const MESSAGES: AiMessages = {
  notConfigured: "A sinopse não está configurada nesta instalação.",
  refusal: "Não consigo descrever este texto.",
  failure: "Não consegui gerar a sinopse agora.",
};

const Schema = z.object({
  synopsis: z
    .string()
    .describe("Sinopse de até 50 palavras, em português do Brasil, sem revelar o desenrolar."),
});

const SYSTEM = [
  "Você escreve a sinopse de um texto para quem ainda não começou a ler.",
  "Recebe só o começo do texto e diz do que ele trata: o assunto, o ponto de partida, o tom.",
  "No máximo 50 palavras, em português do Brasil, mesmo que o texto esteja em outro idioma.",
  "Sem spoiler: não antecipa desfecho, reviravolta nem conclusão, e não inventa o que não está no trecho.",
  "Não começa com \"Este texto\" nem repete o título.",
].join(" ");

export function synopsisKey(textId: string, content: string): string {
  return `${textId}:${contentKey(content)}`;
}

function fingerprint(content: string): string {
  return createHash("md5").update(content, "utf8").digest("hex");
}

export async function cachedSynopsis(
  userId: string,
  textId: string,
  content: string
): Promise<string | null> {
  const stored = await loadAiResult<StoredSynopsis>(
    userId,
    "sinopse",
    synopsisKey(textId, content)
  );
  return stored?.synopsis ?? null;
}

export async function generateSynopsis(
  userId: string,
  textId: string,
  title: string,
  content: string
): Promise<string> {
  const excerpt = synopsisExcerpt(content);
  const parsed = await aiParse({
    task: "sinopse",
    userId,
    textId,
    wordsSent: countWords(excerpt),
    messages: MESSAGES,
    schema: Schema,
    system: SYSTEM,
    // No Haiku o raciocinio conta no teto: folga para ele e a sinopse curta.
    maxTokens: 2000,
    effort: "low",
    timeoutMs: 30_000,
    content: [{ role: "user", content: `Título: ${title}\n\nComeço do texto:\n\n${excerpt}` }],
  });

  const synopsis = clampSynopsis(parsed?.synopsis ?? "");
  if (!synopsis) throw new AiUnavailable(MESSAGES.failure);

  const key = synopsisKey(textId, content);
  // A versao anterior do conteudo nao volta: a sinopse dela so ocuparia espaco.
  await db
    .delete(aiResults)
    .where(
      and(
        eq(aiResults.userId, userId),
        eq(aiResults.textId, textId),
        eq(aiResults.kind, "sinopse"),
        ne(aiResults.key, key)
      )
    );
  await saveAiResult(userId, textId, "sinopse", key, {
    synopsis,
    fingerprint: fingerprint(content),
  } satisfies StoredSynopsis);
  return synopsis;
}

/**
 * Sinopses validas dos textos dados: so as geradas para o conteudo atual.
 * A comparacao do md5 roda no banco, entao a lista nao carrega o conteudo.
 */
export async function synopsesFor(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ textId: aiResults.textId, payload: aiResults.payload })
    .from(aiResults)
    .innerJoin(texts, eq(texts.id, aiResults.textId))
    .where(
      and(
        eq(aiResults.kind, "sinopse"),
        inArray(aiResults.textId, ids),
        eq(aiResults.userId, texts.userId),
        sql`${aiResults.payload}->>'fingerprint' = md5(${texts.content})`
      )
    );
  const result = new Map<string, string>();
  for (const row of rows) {
    const synopsis = (row.payload as Partial<StoredSynopsis>).synopsis;
    if (row.textId && typeof synopsis === "string") result.set(row.textId, synopsis);
  }
  return result;
}
