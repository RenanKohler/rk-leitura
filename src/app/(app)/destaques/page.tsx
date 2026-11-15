import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { HIGHLIGHT_LIBRARY_TITLE } from "@/lib/highlight-library";
import { loadHighlightLibrary } from "@/lib/highlight-library-queries";
import { countDueHighlights } from "@/lib/learning-queries";
import { loadSettings } from "@/lib/queries";
import { AllHighlightsClient } from "./all-highlights-client";

export const dynamic = "force-dynamic";

export const metadata = { title: HIGHLIGHT_LIBRARY_TITLE };

/**
 * Destaques e notas de todos os textos (US-224).
 *
 * Ate aqui eles so apareciam por texto: achar uma nota antiga exigia lembrar
 * em que texto ela estava. A lista vem inteira no HTML (ate o limite da tela)
 * e a busca filtra no aparelho, sem ida ao servidor a cada letra.
 */
export default async function AllHighlightsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const timezone = (await loadSettings(session.id))?.timezone ?? "UTC";
  const [library, due] = await Promise.all([
    loadHighlightLibrary(session.id),
    // O cartao "Revisar destaques" saiu do Inicio: e daqui que a revisao so
    // de destaques continua alcancavel.
    countDueHighlights(session.id, timezone),
  ]);

  return <AllHighlightsClient library={library} due={due} timezone={timezone} />;
}
