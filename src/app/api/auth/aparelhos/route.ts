import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { authSessions } from "@/db/schema";
import { requireSession, serverError } from "@/lib/api";
import { describeDevice } from "@/lib/account-security";

export const dynamic = "force-dynamic";

/** Aparelhos conectados a conta (US-97), o atual marcado. */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const rows = await db
      .select()
      .from(authSessions)
      .where(and(eq(authSessions.userId, session.id), isNull(authSessions.revokedAt)))
      .orderBy(desc(authSessions.lastSeenAt));

    return NextResponse.json({
      devices: rows.map((row) => ({
        id: row.id,
        name: describeDevice(row.userAgent),
        lastSeenAt: row.lastSeenAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        current: row.id === session.sid,
      })),
    });
  } catch (error) {
    return serverError("aparelhos/list", error);
  }
}
