import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { words } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const textId = request.nextUrl.searchParams.get("textId");
    if (!textId) {
      return NextResponse.json({ error: "textId required" }, { status: 400 });
    }

    const result = await db.select().from(words)
      .where(eq(words.textId, textId))
      .orderBy(words.index);

    return NextResponse.json({ words: result });
  } catch (error) {
    console.error("Get words error:", error);
    return NextResponse.json({ error: "Failed to fetch words" }, { status: 500 });
  }
}
