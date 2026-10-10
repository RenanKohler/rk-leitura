import { NextResponse } from "next/server";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { ankiExport, ankiFileName, NO_CARDS_TO_EXPORT } from "@/lib/anki";
import { loadExportCards, loadStudyText } from "@/lib/study-card-store";

export const dynamic = "force-dynamic";

/**
 * Cartoes de estudo para o Anki (US-160), de um texto (`?texto=<id>`) ou de
 * todos. So os de trechos ja lidos, como na tela: exportar os outros
 * revelaria o que vem depois fora do teste de conhecimento previo.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const textId = new URL(request.url).searchParams.get("texto");
    let title: string | null = null;
    if (textId) {
      const text = await loadStudyText(session.id, textId);
      if (!text) return jsonError("Texto não encontrado.", 404);
      title = text.title;
    }

    const cards = await loadExportCards(session.id, textId ?? undefined);
    if (cards.length === 0) return jsonError(NO_CARDS_TO_EXPORT, 404);

    return new NextResponse(ankiExport(cards), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${ankiFileName(title)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return serverError("cartoes/exportar", error);
  }
}
