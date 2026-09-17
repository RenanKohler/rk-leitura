import { NextResponse } from "next/server";
import { requireSession, serverError } from "@/lib/api";
import { loadOverview } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Agregados do painel, calculados no banco.
 *
 * A consulta vive em lib/queries para ser compartilhada com o componente de
 * servidor do painel, que ja entrega esses numeros no HTML.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    return NextResponse.json(await loadOverview(session.id));
  } catch (error) {
    return serverError("stats", error);
  }
}
