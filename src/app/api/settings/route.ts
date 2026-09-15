import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { speedSettings } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.select().from(speedSettings)
      .where(eq(speedSettings.userId, session.id));

    if (result.length === 0) {
      return NextResponse.json({ settings: null });
    }

    return NextResponse.json({ settings: result[0] });
  } catch (error) {
    console.error("Get settings error:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { baseWpm, wordsPerChunk, highlightOpacity } = body;

    const existing = await db.select().from(speedSettings)
      .where(eq(speedSettings.userId, session.id));

    if (existing.length === 0) {
      const result = await db.insert(speedSettings).values({
        userId: session.id,
        baseWpm: baseWpm || 350,
        wordsPerChunk: wordsPerChunk || 4,
        highlightOpacity: highlightOpacity || 0.35,
      }).returning();

      return NextResponse.json({ settings: result[0] });
    }

    const result = await db.update(speedSettings)
      .set({
        baseWpm: baseWpm || existing[0].baseWpm,
        wordsPerChunk: wordsPerChunk || existing[0].wordsPerChunk,
        highlightOpacity: highlightOpacity ?? existing[0].highlightOpacity,
        updatedAt: new Date(),
      })
      .where(eq(speedSettings.id, existing[0].id))
      .returning();

    return NextResponse.json({ settings: result[0] });
  } catch (error) {
    console.error("Update settings error:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
