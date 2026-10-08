import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tags } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { aiConfigured, aiGate } from "@/lib/ai";
import { consumeDailyQuota } from "@/lib/daily-quota";
import { findLeftovers, suggestTags } from "@/lib/import-ai";
import type { Leftover } from "@/lib/import-analysis";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Mesmo teto do texto salvo em `/api/texts`. */
const MAX_CONTENT_CHARS = 400_000;

interface Analysis {
  /** Paragrafos que parecem resto de pagina (US-136). */
  leftovers: Leftover[];
  /** Etiquetas da conta que combinam com o texto (US-137). */
  suggestedTags: string[];
}

const EMPTY: Analysis = { leftovers: [], suggestedTags: [] };

/**
 * Analise da previa da importacao por URL (US-136 e US-137).
 *
 * So a importacao com previa chama esta rota: e nela que alguem confere o
 * resultado antes de salvar. Cada analise feita gasta uma unidade da cota
 * `importacao`; falha, tempo esgotado ou cota acabada devolvem a analise
 * vazia, e a previa segue como antes.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`import-analise:${clientIp(request)}`, 40, 10 * 60 * 1000);
  if (!limit.allowed) return NextResponse.json(EMPTY);

  try {
    const body = await readJson<{ title?: unknown; content?: unknown; extraction?: unknown }>(
      request
    );
    // Sem `trim`: os indices devolvidos contam os paragrafos do texto como a
    // tela o tem, e cortar o comeco deslocaria todos eles.
    const content = typeof body?.content === "string" ? body.content : "";
    const title = typeof body?.title === "string" ? body.title.slice(0, 300) : "";
    if (!content.trim()) return jsonError("Informe o conteúdo.", 400);
    if (content.length > MAX_CONTENT_CHARS) return NextResponse.json(EMPTY);

    // Sem chave nada sairia do app: nem gasta cota nem consulta etiquetas.
    if (!aiConfigured()) return NextResponse.json(EMPTY);

    // Corpo declarado pela pagina nao tem o que limpar (US-136, criterio 3).
    const wantsCleanup = body?.extraction === "palpite";
    const known = (
      await db.select({ name: tags.name }).from(tags).where(eq(tags.userId, session.id))
    ).map((row) => row.name);
    // Sem etiquetas na conta, nenhuma chamada (US-137, criterio 3).
    const wantsTags = known.length > 0;
    if (!wantsCleanup && !wantsTags) return NextResponse.json(EMPTY);

    const gate = await aiGate(session.id);
    if (gate) return gate;

    const cleanupAllowed =
      wantsCleanup && (await consumeDailyQuota("importacao", session.id)).allowed;
    const tagsAllowed = wantsTags && (await consumeDailyQuota("importacao", session.id)).allowed;

    const [leftovers, suggestedTags] = await Promise.all([
      cleanupAllowed ? findLeftovers(session.id, content).catch(quiet("limpeza")) : [],
      tagsAllowed
        ? suggestTags(session.id, title, content, known).catch(quiet("etiquetas"))
        : [],
    ]);

    return NextResponse.json({ leftovers, suggestedTags } satisfies Analysis);
  } catch (error) {
    return serverError("import-url/analise", error);
  }
}

/** Falha da analise vira "sem resultado": a previa nunca depende dela. */
function quiet(task: string) {
  return (error: unknown): never[] => {
    console.warn(`[ia] analise de importacao (${task}) sem resultado:`, error);
    return [];
  };
}
