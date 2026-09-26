import { NextResponse } from "next/server";
import { clearSession, getSession, revokeSessions } from "@/lib/auth";

export async function POST() {
  // Sair tira este aparelho da lista de conectados (US-97).
  const session = await getSession();
  if (session?.sid) await revokeSessions(session.id, session.sid).catch(() => undefined);
  await clearSession();
  return NextResponse.json({ success: true });
}
