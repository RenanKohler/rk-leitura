import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, database: "up" });
  } catch (error) {
    console.error("[health]", error);
    return Response.json({ ok: false, database: "down" }, { status: 503 });
  }
}
