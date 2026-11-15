import { NextResponse } from "next/server";
import { requireSession, serverError } from "@/lib/api";
import { libraryExportFileName, libraryMarkdown } from "@/lib/highlight-library";
import { loadHighlightExport } from "@/lib/highlight-library-queries";
import { loadSettings } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Todos os destaques e notas da conta em um arquivo Markdown (US-224).
 *
 * E rota, e nao montagem na tela como na exportacao de um texto, porque a
 * tela carrega so os destaques mais recentes e nao tem autor, origem nem
 * etiquetas: o arquivo precisa de tudo. Os trechos saem da mesma funcao que
 * monta a tela, entao nao ha como os dois discordarem.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const timezone = (await loadSettings(session.id))?.timezone ?? "UTC";
    const { texts, items, total } = await loadHighlightExport(session.id);
    const now = new Date();

    return new NextResponse(libraryMarkdown(texts, items, { timezone, now, total }), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${libraryExportFileName(timezone, now)}"`,
        // Dados da conta nao devem ficar em cache de proxy nenhum.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return serverError("destaques/exportar", error);
  }
}
