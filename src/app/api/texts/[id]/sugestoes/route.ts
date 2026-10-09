import { NextResponse } from "next/server";
import { jsonError, readJson, requireSession } from "@/lib/api";
import { aiGate } from "@/lib/ai";
import { loadAiResult, saveAiResult } from "@/lib/ai-results";
import { askExcerpt, parseSuggestions, suggestionCut, suggestionsKey } from "@/lib/ask";
import { loadText } from "@/lib/queries";
import { contentKey } from "@/lib/quiz";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { parseParagraphs } from "@/lib/reading";
import { suggestQuestions } from "@/lib/suggestions-generator";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Teto do trecho enviado para sugerir perguntas: o fim do que foi lido basta. */
const SUGGESTION_CHARS = 30_000;

/** Geracoes de sugestoes por conta por dia. Nao e cota visivel: so freio contra abuso. */
const DAILY_GENERATIONS = 100;

type Params = { params: Promise<{ id: string }> };

const EMPTY = { suggestions: [] as string[] };

/**
 * Perguntas sugeridas sobre o trecho lido (US-148).
 *
 * Nao gasta a cota de perguntas: so a pergunta enviada conta. O freio fica no
 * cache por faixa de 1.000 palavras (reabrir na mesma faixa nao chama o
 * modelo), no limite por IP e num teto diario por conta. Qualquer falha
 * devolve lista vazia: a folha abre como antes, sem mensagem de erro.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`sugestoes:${clientIp(request)}`, 60, 60 * 60 * 1000);
  if (!limit.allowed) return NextResponse.json(EMPTY);

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);

    const body = await readJson<{ position?: unknown }>(request);
    const cut = suggestionCut(Number(body?.position));
    if (cut === null) return NextResponse.json(EMPTY);

    const text = await loadText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const key = suggestionsKey(id, contentKey(text.content), cut);
    const known = parseSuggestions(await loadAiResult<unknown>(session.id, "sugestoes", key));
    if (known.length > 0) return NextResponse.json({ suggestions: known, cached: true });

    // Sem permissao da conta (US-125), nada sai do app.
    const gate = await aiGate(session.id);
    if (gate) return gate;

    const daily = await rateLimit(`sugestoes-dia:${session.id}`, DAILY_GENERATIONS, 24 * 60 * 60 * 1000);
    if (!daily.allowed) return NextResponse.json(EMPTY);

    const { paragraphs } = parseParagraphs(text.content, text.format);
    // Corte no comeco da faixa: o trecho termina antes da posicao de leitura.
    const excerpt = askExcerpt(paragraphs, cut - 1, SUGGESTION_CHARS);
    if (excerpt.text.length === 0) return NextResponse.json(EMPTY);

    const suggestions = await suggestQuestions(
      session.id,
      id,
      text.title,
      excerpt.text,
      text.language
    );
    if (suggestions.length > 0) {
      await saveAiResult(session.id, id, "sugestoes", key, { questions: suggestions });
    }
    return NextResponse.json({ suggestions, cached: false });
  } catch (error) {
    // Sugestao e conveniencia: falha nao vira erro na folha.
    console.error("[ia] sugestoes falhou:", error);
    return NextResponse.json(EMPTY);
  }
}
