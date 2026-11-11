import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
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

/**
 * Registra que o leitor aceitou ou dispensou a sugestao (US-218).
 *
 * Fica na conta, e nao no aparelho: a sugestao dispensada no celular nao
 * volta no computador. O que muda a velocidade continua sendo a gravacao
 * normal das preferencias; aqui so se anota a resposta.
 */
export async function POST() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    await db.update(users).set({ slowdownAnsweredAt: new Date() }).where(eq(users.id, session.id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError("sessions/sugestao", error);
  }
}
