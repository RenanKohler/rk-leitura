import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { speedSettings } from "@/db/schema";
import { readJson, requireSession, serverError } from "@/lib/api";
import {
  asFontFamily,
  clamp,
  MAX_CHUNK,
  MAX_FONT_SCALE,
  MAX_HIGHLIGHT,
  MAX_LINE_HEIGHT,
  MAX_WPM,
  MIN_CHUNK,
  MIN_FONT_SCALE,
  MIN_HIGHLIGHT,
  MIN_LINE_HEIGHT,
  MIN_WPM,
} from "@/lib/reading";
import { DEFAULT_SETTINGS, loadSettings } from "@/lib/queries";

export const dynamic = "force-dynamic";

const READING_MODES = new Set(["rsvp", "flow", "page"]);
const THEMES = new Set(["system", "light", "dark"]);

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    // Sempre devolve algo utilizavel: o cliente nao precisa tratar null.
    return NextResponse.json({ settings: await loadSettings(session.id) });
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
      highlightOpacity: clamp(Number(body?.highlightOpacity), MIN_HIGHLIGHT, MAX_HIGHLIGHT),
      readingMode: READING_MODES.has(String(body?.readingMode))
        ? String(body?.readingMode)
        : DEFAULT_SETTINGS.readingMode,
      theme: THEMES.has(String(body?.theme)) ? String(body?.theme) : DEFAULT_SETTINGS.theme,
      fontScale: clamp(Math.trunc(Number(body?.fontScale)), MIN_FONT_SCALE, MAX_FONT_SCALE),
      fontFamily: asFontFamily(body?.fontFamily),
      lineHeightStep: clamp(
        Math.trunc(Number(body?.lineHeightStep)),
        MIN_LINE_HEIGHT,
        MAX_LINE_HEIGHT
      ),
      warmup: body?.warmup !== false,
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
