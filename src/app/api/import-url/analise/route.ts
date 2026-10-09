import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tags } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { aiConfigured, aiGate } from "@/lib/ai";
import { consumeDailyQuota } from "@/lib/daily-quota";
import { analyzePreview, suggestTags, type PreviewAnalysis } from "@/lib/import-ai";
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
  /** Titulo sugerido quando a origem nao trouxe um (US-152). */
  suggestedTitle: string | null;
  /** Autor sugerido, so quando o nome aparece no comeco do texto (US-152). */
  suggestedAuthor: string | null;
}

const EMPTY: Analysis = {
  leftovers: [],
  suggestedTags: [],
  suggestedTitle: null,
  suggestedAuthor: null,
};

/**
 * Analise da previa da importacao (US-136, US-137 e US-152).
 *
 * So a importacao com previa chama esta rota: e nela que alguem confere o
 * resultado antes de salvar. A importacao de arquivo tambem chama, mas so
 * para titulo e autor (`meta`), quando o arquivo nao trouxe titulo. Limpeza
 * e titulo vao na mesma chamada. Cada chamada feita gasta uma unidade da cota
 * `importacao`; falha, tempo esgotado ou cota acabada devolvem a analise
 * vazia, e a previa segue como antes.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`import-analise:${clientIp(request)}`, 40, 10 * 60 * 1000);
  if (!limit.allowed) return NextResponse.json(EMPTY);

  try {
    const body = await readJson<{
      title?: unknown;
      content?: unknown;
      extraction?: unknown;
      meta?: unknown;
      tags?: unknown;
    }>(
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
    // A importacao de arquivo nao tem seletor de etiquetas: pede `tags: false`.
    const known =
      body?.tags === false
        ? []
        : (
            await db.select({ name: tags.name }).from(tags).where(eq(tags.userId, session.id))
          ).map((row) => row.name);
    // Sem etiquetas na conta, nenhuma chamada (US-137, criterio 3).
    const wantsTags = known.length > 0;
    // Origem sem titulo: a mesma chamada sugere titulo e autor (US-152).
    const wantsMeta = body?.meta === true;
    if (!wantsCleanup && !wantsTags && !wantsMeta) return NextResponse.json(EMPTY);

    const gate = await aiGate(session.id);
    if (gate) return gate;

    const previewAllowed =
      (wantsCleanup || wantsMeta) &&
      (await consumeDailyQuota("importacao", session.id)).allowed;
    const tagsAllowed = wantsTags && (await consumeDailyQuota("importacao", session.id)).allowed;

    const [preview, suggestedTags] = await Promise.all([
      previewAllowed
        ? analyzePreview(session.id, content, { cleanup: wantsCleanup, meta: wantsMeta }).catch(
            (error: unknown): PreviewAnalysis => {
              quiet("limpeza")(error);
              return { leftovers: [], title: null, author: null };
            }
          )
        : { leftovers: [], title: null, author: null },
      tagsAllowed
        ? suggestTags(session.id, title, content, known).catch(quiet("etiquetas"))
        : [],
    ]);

    return NextResponse.json({
      leftovers: preview.leftovers,
      suggestedTags,
      suggestedTitle: preview.title,
      suggestedAuthor: preview.author,
    } satisfies Analysis);
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
