import { NextResponse } from "next/server";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { loadTimeWindow } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Ate 3 leituras que cabem em `?min=` minutos, no ritmo real (US-84). */
export async function GET(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const minutes = Math.trunc(Number(new URL(request.url).searchParams.get("min")));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) {
    return jsonError("Informe de 1 a 240 minutos.", 400);
  }

  try {
    return NextResponse.json(await loadTimeWindow(session.id, minutes));
  } catch (error) {
    return serverError("tempo-livre", error);
  }
}
