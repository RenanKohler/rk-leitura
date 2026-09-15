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
