import { NextResponse } from "next/server";
import { getSession, getUserById } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ user: null });

    // Revalida contra o banco: a conta pode ter sido apagada depois do token.
    const user = await getUserById(session.id);
    if (!user) return NextResponse.json({ user: null });

    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    console.error("[auth/me]", error);
    return NextResponse.json({ user: null });
  }
}
