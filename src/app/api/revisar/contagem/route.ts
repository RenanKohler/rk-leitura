import { NextResponse } from "next/server";
import { requireSession, serverError } from "@/lib/api";
import { loadSettings } from "@/lib/queries";
import { countDailyReview } from "@/lib/study-review-queries";

export const dynamic = "force-dynamic";

/**
 * Quantos itens a Revisao do dia tem vencidos hoje (US-229).
 *
 * E o numero do selo da aba "Revisar": a barra de navegacao pede a cada troca
 * de rota. So o total sai daqui - a divisao por tipo fica com a tela da
 * revisao. "Hoje" e o dia no fuso do leitor, como na propria revisao.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const timezone = (await loadSettings(session.id))?.timezone ?? "UTC";
    const { total } = await countDailyReview(session.id, timezone);
    return NextResponse.json({ total });
  } catch (error) {
    return serverError("revisar/contagem", error);
  }
}
