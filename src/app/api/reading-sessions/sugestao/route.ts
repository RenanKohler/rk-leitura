import { NextResponse } from "next/server";
import { requireSession, serverError } from "@/lib/api";
import { loadSlowdownSuggestion } from "@/lib/learning-queries";
import { clamp, MAX_WPM, MIN_WPM } from "@/lib/reading";

export const dynamic = "force-dynamic";

/**
 * Sugestao de desacelerar (PROD-10), para o leitor consultar ao abrir.
 *
 * Resposta: `{ suggestion: { deltaWpm, brakesPer150, sessions, message } | null,
 * baseWpm, suggestedWpm }`. So sugere: a velocidade so muda se o leitor aceitar,
 * pela gravacao normal das preferencias.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { suggestion, baseWpm } = await loadSlowdownSuggestion(session.id);
    return NextResponse.json({
      suggestion,
      baseWpm,
      suggestedWpm: suggestion ? clamp(baseWpm + suggestion.deltaWpm, MIN_WPM, MAX_WPM) : null,
    });
  } catch (error) {
    return serverError("sessions/sugestao", error);
  }
}
