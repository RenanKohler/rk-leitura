import { NextResponse } from "next/server";
import { readPageParams, requireSession, serverError } from "@/lib/api";
import { loadTexts } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Lista plana de textos, sem agrupar por serie.
 *
 * Existe separada de `/api/texts` porque o painel quer as ultimas leituras em
 * ordem, nao a biblioteca organizada: um cartao de serie ali esconderia
 * justamente o capitulo que a pessoa estava lendo. Segmento estatico vence o
 * dinamico no roteamento, entao nao conflita com `/api/texts/[id]`.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const params = readPageParams(request);
    const { items, ...page } = await loadTexts(session.id, params.page, params.limit);
    return NextResponse.json({ texts: items, ...page });
  } catch (error) {
    return serverError("texts/recentes", error);
  }
}
