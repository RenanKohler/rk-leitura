import "server-only";

import { NextResponse } from "next/server";
import { getSession, type SessionUser } from "@/lib/auth";

export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export const unauthorized = () => jsonError("Sessao expirada. Entre novamente.", 401);

/**
 * Devolve a sessao ou uma resposta 401 pronta. Uso:
 *   const session = await requireSession();
 *   if (session instanceof NextResponse) return session;
 */
export async function requireSession(): Promise<SessionUser | NextResponse> {
  const session = await getSession();
  return session ?? unauthorized();
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** Log no servidor, mensagem generica para o cliente. */
export function serverError(scope: string, error: unknown) {
  console.error(`[${scope}]`, error);
  return jsonError("Algo deu errado. Tente novamente.", 500);
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
