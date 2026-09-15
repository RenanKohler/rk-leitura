import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const result = await db.select().from(texts)
      .where(and(eq(texts.id, id), eq(texts.userId, session.id)));

    if (result.length === 0) {
      return NextResponse.json({ error: "Text not found" }, { status: 404 });
    }

    return NextResponse.json({ text: result[0] });
  } catch (error) {
    console.error("Get text error:", error);
    return NextResponse.json({ error: "Failed to fetch text" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { title, sourceUrl, content } = body;

    if (!title || !sourceUrl || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const existing = await db.select().from(texts)
      .where(and(eq(texts.id, id), eq(texts.userId, session.id)));

    if (existing.length === 0) {
      return NextResponse.json({ error: "Text not found" }, { status: 404 });
    }

    const result = await db.update(texts)
      .set({
        title,
        sourceUrl,
        content,
        wordCount: content.split(/\s+/).filter((w: string) => w.length > 0).length,
        updatedAt: new Date(),
      })
      .where(eq(texts.id, id))
      .returning();

    return NextResponse.json({ text: result[0] });
  } catch (error) {
    console.error("Update text error:", error);
    return NextResponse.json({ error: "Failed to update text" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const existing = await db.select().from(texts)
      .where(and(eq(texts.id, id), eq(texts.userId, session.id)));

    if (existing.length === 0) {
      return NextResponse.json({ error: "Text not found" }, { status: 404 });
    }

    await db.delete(texts).where(eq(texts.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete text error:", error);
    return NextResponse.json({ error: "Failed to delete text" }, { status: 500 });
  }
}
