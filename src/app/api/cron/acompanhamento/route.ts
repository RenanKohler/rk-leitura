import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { runFollowUps } from "@/lib/follow-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Margem para gravar o estado antes de a funcao ser encerrada. */
const BUDGET_MS = 45_000;

/**
 * Verificacao de series acompanhadas e feeds (US-70, US-71).
 *
 * Chamada de hora em hora pelo mesmo fluxo do GitHub que dispara o lembrete.
 * Cada fonte e consultada no maximo a cada 6 horas, entao chamadas extras nao
 * sobrecarregam as origens nem duplicam importacoes.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    return NextResponse.json(await runFollowUps(new Date(), Date.now() + BUDGET_MS));
  } catch (error) {
    return serverError("cron/acompanhamento", error);
  }
}
