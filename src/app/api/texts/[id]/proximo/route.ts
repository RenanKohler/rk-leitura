import { NextResponse } from "next/server";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { importNextChapter } from "@/lib/chapter-import";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Busca o proximo capitulo da serie na origem e o salva.
 *
 * Existe separado da continuacao (US-23) porque sao dois movimentos
 * diferentes: a continuacao anexa mais paginas ao mesmo capitulo, esta cria o
 * capitulo seguinte como texto proprio.
 *
 * Nunca devolve erro por nao haver proximo capitulo: fim de serie e uma
 * resposta valida, e a tela de conclusao nao pode quebrar por causa dela.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`capitulo:${clientIp(request)}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas buscas seguidas. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const result = await importNextChapter(session.id, id);

    switch (result.status) {
      case "missing":
        return jsonError("Texto nao encontrado.", 404);
      case "imported":
        return NextResponse.json(
          { status: "imported", id: result.id, title: result.title },
          { status: 201 }
        );
      case "existing":
        return NextResponse.json({ status: "existing", id: result.id, title: result.title });
      default:
        // Fim de serie e origem fora do ar: a tela de conclusao so informa.
        return NextResponse.json({ status: "end", message: result.message });
    }
  } catch (error) {
    return serverError("texts/proximo", error);
  }
}
