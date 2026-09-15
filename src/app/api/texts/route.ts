import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { eq, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.select().from(texts)
      .where(eq(texts.userId, session.id))
      .orderBy(desc(texts.createdAt));

    return NextResponse.json({ texts: result });
  } catch (error) {
    console.error("Get texts error:", error);
    return NextResponse.json({ error: "Failed to fetch texts" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { title, sourceUrl, content, wordCount } = body;

    if (!title || !sourceUrl || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const result = await db.insert(texts).values({
      userId: session.id,
      title,
      sourceUrl,
      content,
      wordCount: wordCount || 0,
    }).returning();

    return NextResponse.json({ text: result[0] });
  } catch (error) {
    console.error("Create text error:", error);
    return NextResponse.json({ error: "Failed to create text" }, { status: 500 });
  }
}
