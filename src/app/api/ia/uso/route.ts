import { NextResponse } from "next/server";
import { requireSession, serverError } from "@/lib/api";
import { aiConfigured, aiConsent } from "@/lib/ai";
import { readDailyUsage } from "@/lib/daily-quota";
import { DAILY_QUOTAS, QUOTA_LABELS, type QuotaKind } from "@/lib/quota";

export const dynamic = "force-dynamic";

/**
 * Quanto de cada cota de IA a conta ja usou hoje (US-126).
 *
 * Le os contadores que a propria cota grava; nenhuma tabela nova. O cliente
 * so mostra: o teto e a contagem vem daqui, nunca de uma copia na tela.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const configured = aiConfigured();
    const consent = await aiConsent(session.id);
    if (!configured) return NextResponse.json({ configured, consent, quotas: [] });

    const { timezone, used } = await readDailyUsage(session.id);
    const quotas = (Object.keys(DAILY_QUOTAS) as QuotaKind[]).map((kind) => ({
      kind,
      label: QUOTA_LABELS[kind],
      used: used[kind],
      limit: DAILY_QUOTAS[kind],
    }));
    return NextResponse.json({ configured, consent, timezone, quotas });
  } catch (error) {
    return serverError("ia/uso", error);
  }
}
