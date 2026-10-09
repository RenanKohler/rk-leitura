"use client";

/** Cliente HTTP minimo para as rotas internas. */

import { isEventStream, readEvents, type StreamEvent } from "@/lib/ai-stream";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Corpo da resposta de erro, para campos alem da mensagem. */
    readonly data: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      (data as { error?: string }).error ?? "Falha na requisição.",
      response.status,
      data as Record<string, unknown>
    );
  }
  return data as T;
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return parse<T>(await fetch(path, { signal }));
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown
): Promise<T> {
  return parse<T>(
    await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

/**
 * POST a uma rota de IA com streaming (US-145). Erro HTTP vira `ApiError`,
 * como em `apiSend`. Resposta JSON comum (um resultado ja guardado, por
 * exemplo) volta em `data`; um stream entrega cada evento a `onEvent` e
 * devolve como terminou.
 */
export async function apiStream(
  path: string,
  body: unknown,
  { signal, onEvent }: { signal?: AbortSignal; onEvent: (event: StreamEvent) => void }
): Promise<
  | { status: "json"; data: Record<string, unknown> }
  | { status: "done" | "error" | "interrupted" }
> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !isEventStream(response)) {
    return { status: "json", data: await parse<Record<string, unknown>>(response) };
  }
  return { status: await readEvents(response, onEvent) };
}

/**
 * Estado de consentimento que uma rota de IA devolve no 403 (US-125):
 * `pending` quando a conta ainda nao decidiu, `off` quando desligou.
 */
export function consentFrom(cause: unknown): "pending" | "off" | null {
  if (!(cause instanceof ApiError) || cause.status !== 403) return null;
  const consent = cause.data.consent;
  return consent === "pending" || consent === "off" ? consent : null;
}
