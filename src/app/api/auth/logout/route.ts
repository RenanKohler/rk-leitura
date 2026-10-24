import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { readJson } from "@/lib/api";
import { clearSession, getSession, revokeSessions } from "@/lib/auth";

export async function POST(request: Request) {
  // Sair tira este aparelho da lista de conectados (US-97) e apaga as
  // inscricoes de notificacao dele (US-183).
  const session = await getSession();
  if (session?.sid) await revokeSessions(session.id, session.sid).catch(() => undefined);
  // Inscricao anterior ao vinculo com o aparelho: a tela manda o endpoint.
  const body = await readJson<{ endpoint?: unknown }>(request);
  if (session && typeof body?.endpoint === "string") {
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, session.id), eq(pushSubscriptions.endpoint, body.endpoint)))
      .catch(() => undefined);
  }
  await clearSession();
  return NextResponse.json({ success: true });
}
