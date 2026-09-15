import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ user: null });
    }

    const user = await db.select().from(users).where(eq(users.id, session.id));
    if (user.length === 0) {
      return NextResponse.json({ user: null });
    }

    return NextResponse.json({ user: { id: user[0].id, email: user[0].email, name: user[0].name } });
  } catch (error) {
    return NextResponse.json({ user: null });
  }
}
