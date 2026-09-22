import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Desfaz a falencia da fila: cada texto volta a posicao que tinha (US-82). */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{ restore?: unknown }>(request);
    const items = Array.isArray(body?.restore)
      ? body.restore.flatMap((raw) => {
          const item = raw as { id?: unknown; queuePosition?: unknown };
          const position = Number(item?.queuePosition);
          return typeof item?.id === "string" &&
            UUID_PATTERN.test(item.id) &&
            Number.isInteger(position)
            ? [{ id: item.id, queuePosition: position }]
            : [];
        })
      : [];
    if (items.length === 0) return jsonError("Nada a desfazer.", 400);

    await db.transaction(async (tx) => {
      for (const item of items) {
        await tx
          .update(texts)
          .set({ abandonedAt: null, abandonedWords: null, queuePosition: item.queuePosition })
          .where(and(eq(texts.id, item.id), eq(texts.userId, session.id)));
      }
    });

    return NextResponse.json({ restored: items.length });
  } catch (error) {
    return serverError("fila/retomar", error);
  }
}
