import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { clearSession, revokeSessions } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Encerra a sessao em todos os aparelhos, inclusive neste (US-63).
 *
 * Incrementar a versao revoga todo token emitido antes: o proximo pedido de
 * qualquer outro aparelho recebe 401, e o layout autenticado o manda para
 * `/sair`, que apaga o cookie e os caches offline de la.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`account:${clientIp(request)}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas tentativas. Aguarde alguns minutos.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    await db
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
      .where(eq(users.id, session.id));
    await revokeSessions(session.id);
    await clearSession();

    return NextResponse.json({ success: true });
  } catch (error) {
    return serverError("auth/logout-all", error);
  }
}
