import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { savedWords } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { todayIn } from "@/lib/goals";
import { loadSettings } from "@/lib/queries";
import { firstReview } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/** Definicao escrita a mao: curta como as do dicionario. */
const MAX_DEFINITION_CHARS = 500;

/**
 * Marca ou desmarca a palavra como aprendida (US-66), ou troca a definicao.
 *
 * Aprendida sai da revisao e continua na lista. Desmarcar recomeca a
 * sequencia: a proxima revisao e no dia seguinte.
 */
export async function PATCH(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Palavra não encontrada.", 404);

    const body = await readJson<{ learned?: unknown; definition?: unknown }>(request);

    // Definicao escrita a mao (PROD-6): a palavra guardada sem consulta fica
    // com a definicao vazia, e quem revisa pode completar.
    if (typeof body?.definition === "string") {
      const definition = body.definition.trim().slice(0, MAX_DEFINITION_CHARS);
      const [edited] = await db
        .update(savedWords)
        // As alternativas da revisao (US-151) eram erradas em relacao a
        // definicao antiga: com a nova, a palavra volta a revisao de sempre.
        .set({ definition, distractors: null, updatedAt: new Date() })
        .where(and(eq(savedWords.id, id), eq(savedWords.userId, session.id)))
        .returning({ id: savedWords.id });
      if (!edited) return jsonError("Palavra não encontrada.", 404);
      return NextResponse.json({ definition });
    }

    if (typeof body?.learned !== "boolean") return jsonError("Informe se foi aprendida.", 400);

    const changes = { learnedAt: body.learned ? new Date() : null };
    const restart = body.learned
      ? null
      : firstReview(todayIn((await loadSettings(session.id))?.timezone ?? "UTC"));

    const [updated] = await db
      .update(savedWords)
      .set({
        ...changes,
        ...(restart ? { reviewStep: restart.step, nextReviewOn: restart.nextReviewOn } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(savedWords.id, id), eq(savedWords.userId, session.id)))
      .returning({ id: savedWords.id });

    if (!updated) return jsonError("Palavra não encontrada.", 404);
    return NextResponse.json({ learned: body.learned });
  } catch (error) {
    return serverError("palavras/aprendida", error);
  }
}
