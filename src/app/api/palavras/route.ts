import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { savedWords, texts } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { DEFAULT_LANGUAGE } from "@/lib/language";
import { todayIn } from "@/lib/goals";
import { loadSettings } from "@/lib/queries";
import { firstReview } from "@/lib/vocabulary";
import { normalizeWord, trimContext, wordKey } from "@/lib/dictionary";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guarda a palavra para revisar sem definicao (PROD-6).
 *
 * E a saida quando o dicionario falha - sem chave, sem cota, servico fora. A
 * palavra entra na revisao com a frase de origem, que ja ajuda a lembrar; a
 * definicao fica vazia, editavel em Palavras, e a proxima consulta da mesma
 * palavra tenta busca-la de novo. Nao chama modelo nenhum.
 *
 * `POST { word, context?, textId? }` -> `{ id, saved: true }`.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{ word?: unknown; context?: unknown; textId?: unknown }>(request);
    const word = normalizeWord(body?.word);
    if (!word) return jsonError("Informe a palavra.", 400);

    const context = trimContext(body?.context);
    const requestedTextId =
      typeof body?.textId === "string" && UUID_PATTERN.test(body.textId) ? body.textId : null;

    // Idioma do texto no banco, como na consulta: a mesma palavra em outro
    // idioma e outra linha.
    const [source] = requestedTextId
      ? await db
          .select({ id: texts.id, language: texts.language })
          .from(texts)
          .where(and(eq(texts.id, requestedTextId), eq(texts.userId, session.id)))
          .limit(1)
      : [];
    const language = source?.language ?? DEFAULT_LANGUAGE;

    const [created] = await db
      .insert(savedWords)
      .values({
        userId: session.id,
        word,
        base: word.toLocaleLowerCase(),
        kind: "",
        definition: "",
        language,
        textId: source?.id ?? null,
        context: context || null,
        nextReviewOn: firstReview(todayIn((await loadSettings(session.id))?.timezone ?? "UTC"))
          .nextReviewOn,
      })
      .onConflictDoNothing()
      .returning({ id: savedWords.id });

    if (created) return NextResponse.json({ id: created.id, saved: true }, { status: 201 });

    // Ja estava guardada: devolve a mesma linha em vez de erro.
    const [existing] = await db
      .select({ id: savedWords.id })
      .from(savedWords)
      .where(
        and(
          eq(savedWords.userId, session.id),
          eq(savedWords.language, language),
          sql`translate(lower(${savedWords.word}), 'áàâãäåéèêëíìîïóòôõöøúùûüçñýÿ', 'aaaaaaeeeeiiiioooooouuuucnyy') = ${wordKey(word)}`
        )
      )
      .limit(1);
    return NextResponse.json({ id: existing?.id ?? null, saved: true });
  } catch (error) {
    return serverError("palavras/guardar", error);
  }
}
