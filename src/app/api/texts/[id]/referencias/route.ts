import { NextResponse } from "next/server";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { reprocessCitations } from "@/lib/reprocess";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/** Omite ou restaura as referencias de um texto ja salvo. */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const body = await readJson<{ acao?: unknown }>(request);
    const mode = body?.acao === "restaurar" ? "restaurar" : body?.acao === "omitir" ? "omitir" : null;
    if (!mode) return jsonError("Informe acao: omitir ou restaurar.", 400);

    const result = await reprocessCitations(session.id, id, mode);
    switch (result.status) {
      case "done":
      case "unchanged":
        return NextResponse.json(result);
      case "not-found":
        return jsonError(result.message, 404);
      case "no-original":
        return jsonError(result.message, 400);
      case "unsafe":
        return jsonError(result.message, 409);
    }
  } catch (error) {
    return serverError("referencias", error);
  }
}
