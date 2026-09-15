import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { speedSettings } from "@/db/schema";
import { readJson, requireSession, serverError } from "@/lib/api";
import { clamp, MAX_CHUNK, MAX_WPM, MIN_CHUNK, MIN_WPM } from "@/lib/reading";

export const dynamic = "force-dynamic";

export const DEFAULT_SETTINGS = {
  baseWpm: 300,
  wordsPerChunk: 1,
  highlightOpacity: 0.35,
  readingMode: "rsvp" as const,
  theme: "system" as const,
};

const READING_MODES = new Set(["rsvp", "flow", "page"]);
const THEMES = new Set(["system", "light", "dark"]);

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const [settings] = await db
      .select()
      .from(speedSettings)
      .where(eq(speedSettings.userId, session.id))
      .limit(1);

    // Sempre devolve algo utilizavel: o cliente nao precisa tratar null.
    return NextResponse.json({ settings: settings ?? { ...DEFAULT_SETTINGS, userId: session.id } });
  } catch (error) {
    return serverError("settings/get", error);
  }
}

export async function PUT(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<Record<string, unknown>>(request);

    const values = {
      baseWpm: clamp(Math.trunc(Number(body?.baseWpm)), MIN_WPM, MAX_WPM),
      wordsPerChunk: clamp(Math.trunc(Number(body?.wordsPerChunk)), MIN_CHUNK, MAX_CHUNK),
      highlightOpacity: clamp(Number(body?.highlightOpacity), 0.1, 0.8),
      readingMode: READING_MODES.has(String(body?.readingMode))
        ? String(body?.readingMode)
        : DEFAULT_SETTINGS.readingMode,
      theme: THEMES.has(String(body?.theme)) ? String(body?.theme) : DEFAULT_SETTINGS.theme,
    };

    // Um unico round-trip: o indice unico em user_id resolve a corrida entre
    // duas abas salvando ao mesmo tempo.
    const [settings] = await db
      .insert(speedSettings)
      .values({ userId: session.id, ...values })
      .onConflictDoUpdate({
        target: speedSettings.userId,
        set: { ...values, updatedAt: new Date() },
      })
      .returning();

    return NextResponse.json({ settings });
  } catch (error) {
    return serverError("settings/update", error);
  }
}
