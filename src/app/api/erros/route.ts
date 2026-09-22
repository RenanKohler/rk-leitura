import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { errorEntry, isRefCode, sanitizeMessage, sanitizeStack } from "@/lib/error-log";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface Body {
  ref?: unknown;
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  digest?: unknown;
  path?: unknown;
}

const MAX_FIELD = 4000;

function field(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, MAX_FIELD) : undefined;
}

/**
 * Recebe o erro que quebrou uma tela no navegador (US-73).
 *
 * Grava no mesmo formato dos erros do servidor, com o codigo que a tela de
 * erro mostrou. Aberta a visitantes, porque a tela pode quebrar antes do
 * login; o limite por IP impede que vire um jeito de encher o log.
 */
export async function POST(request: Request) {
  const limit = await rateLimit(`erros:${clientIp(request)}`, 10, 10 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitos relatos seguidos.", 429, { retryAfter: limit.retryAfterSeconds });
  }

  const body = await readJson<Body>(request);
  if (!isRefCode(body?.ref)) return jsonError("Codigo de referencia invalido.", 400);

  const session = await getSession().catch(() => null);
  const digest = field(body?.digest);
  const path = field(body?.path)?.split("?")[0];

  console.error(
    JSON.stringify(
      errorEntry({
        ref: body.ref,
        scope: "tela",
        source: "navegador",
        userId: session?.id ?? null,
        ...(path ? { path } : {}),
        error: {
          name: field(body?.name)?.slice(0, 100) ?? "Error",
          message: sanitizeMessage(field(body?.message) ?? ""),
          ...(digest ? { code: digest.slice(0, 100) } : {}),
          ...(sanitizeStack(field(body?.stack)) ? { stack: sanitizeStack(field(body?.stack)) } : {}),
        },
      })
    )
  );

  return NextResponse.json({ received: true });
}
