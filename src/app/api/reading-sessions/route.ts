import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { readingSessions } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { eq, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.select().from(readingSessions)
      .where(eq(readingSessions.userId, session.id))
      .orderBy(desc(readingSessions.createdAt));

    return NextResponse.json({ sessions: result });
  } catch (error) {
    console.error("Get sessions error:", error);
    return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { textId, wpm, wordsRead, durationMs, completed } = body;

    if (!textId || !wpm || !wordsRead) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const result = await db.insert(readingSessions).values({
      userId: session.id,
      textId,
      wpm,
      wordsRead,
      durationMs: durationMs || 0,
      completed: completed || 0,
    }).returning();

    return NextResponse.json({ session: result[0] });
  } catch (error) {
    console.error("Create session error:", error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
