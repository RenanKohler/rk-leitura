import "server-only";

import { after, NextResponse } from "next/server";
import {
  currentSessionVersion,
  getSession,
  sessionIsCurrent,
  type SessionUser,
} from "@/lib/auth";
import { errorEntry, newRefCode, summarizeError, userMessage } from "@/lib/error-log";

export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export const unauthorized = () => jsonError("Sessao expirada. Entre novamente.", 401);

/**
 * Devolve a sessao ou uma resposta 401 pronta. Uso:
 *   const session = await requireSession();
 *   if (session instanceof NextResponse) return session;
 *
 * Confirma a conta no banco, nao so a assinatura do token. Uma conta apagada
 * em outro dispositivo deixa um token que continua valido; sem esta consulta,
 * a primeira escrita falharia por chave estrangeira e o usuario veria um erro
 * generico de servidor em vez de "entre novamente".
 */
export async function requireSession(): Promise<SessionUser | NextResponse> {
  const session = await getSession();
  if (!session) return unauthorized();
  // A versao cobre tambem a troca de senha e o "sair de todos os aparelhos":
  // o token continua assinado, mas foi revogado (US-62, US-63).
  return sessionIsCurrent(session, await currentSessionVersion(session.id))
    ? session
    : unauthorized();
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Registro estruturado no servidor, mensagem generica para o cliente - com o
 * codigo que liga uma a outra (US-73).
 *
 * O id do usuario sai do cookie depois da resposta, via `after`: assim as
 * dezenas de rotas que chamam isto continuam sincronas. Fora de uma
 * requisicao `after` recusa, e a linha e gravada na hora, sem o usuario.
 */
export function serverError(scope: string, error: unknown) {
  const ref = newRefCode();
  const summary = summarizeError(error);
  const write = (userId: string | null) =>
    console.error(
      JSON.stringify(errorEntry({ ref, scope, source: "servidor", userId, error: summary }))
    );

  try {
    after(async () => {
      const session = await getSession().catch(() => null);
      write(session?.id ?? null);
    });
  } catch {
    write(null);
  }

  return jsonError(userMessage(ref), 500, { ref });
}

/**
 * Verdadeiro quando a falha e uma violacao de indice unico.
 *
 * O driver reporta o codigo `23505`, mas o Drizzle embrulha o erro antes de
 * repassar: a checagem precisa olhar tambem a causa, senao um nome repetido
 * chega a tela como "algo deu errado" em vez do aviso que explica o que fazer.
 */
export function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 4; depth += 1) {
    if (typeof current !== "object") break;
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function asInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface PageParams {
  limit: number;
  offset: number;
  page: number;
}

/** Le ?page= e ?perPage= da URL, com limites sensatos. */
export function readPageParams(request: Request): PageParams {
  const params = new URL(request.url).searchParams;

  const page = Math.max(1, Math.trunc(Number(params.get("page")) || 1));
  const requested = Math.trunc(Number(params.get("perPage")) || DEFAULT_PAGE_SIZE);
  const limit = Math.min(Math.max(1, requested), MAX_PAGE_SIZE);

  return { limit, offset: (page - 1) * limit, page };
}

export function pageMeta(total: number, { page, limit }: PageParams) {
  return {
    total,
    page,
    perPage: limit,
    pageCount: Math.max(1, Math.ceil(total / limit)),
  };
}
