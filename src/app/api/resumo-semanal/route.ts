import { NextResponse } from "next/server";
import { db } from "@/db";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { loadSettings } from "@/lib/queries";
import { mondayOf, todayIn } from "@/lib/goals";
import { upsertSettings } from "@/lib/settings-row";

export const dynamic = "force-dynamic";

/**
 * Dispensa o resumo da semana corrente.
 *
 * A marca e a segunda-feira desta semana, nao um sinalizador: na semana
 * seguinte a data muda e o cartao volta sozinho, sem precisar de uma rotina
 * que limpe o estado toda segunda.
 */
export async function POST() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const settings = await loadSettings(session.id);
    if (!settings) return jsonError("Sessao expirada. Entre novamente.", 401);

    const monday = mondayOf(todayIn(settings.timezone));
    await upsertSettings(db, session.id, { weeklySummarySeenOn: monday });

    return NextResponse.json({ dismissed: monday });
  } catch (error) {
    return serverError("resumo-semanal", error);
  }
}
