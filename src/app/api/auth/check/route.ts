import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    const result = await db.select().from(users).where(eq(users.email, email));
    return NextResponse.json({ exists: result.length > 0 });
  } catch (error) {
    return NextResponse.json({ error: "Check failed" }, { status: 500 });
  }
}
