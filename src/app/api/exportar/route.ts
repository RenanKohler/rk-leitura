import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { highlights, readingSessions, texts } from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { excerptOf } from "@/lib/highlights";
import { asTextFormat, parseParagraphs } from "@/lib/reading";

export const dynamic = "force-dynamic";

/**
 * Download dos dados da conta.
 *
 * Fecha o par com a exclusao (US-07): uma conta que pode ser apagada precisa
 * poder ser levada embora antes. Os dois formatos seguem o uso: sessoes viram
 * CSV porque o destino e planilha, e a biblioteca vira JSON porque o conteudo
 * dos textos tem quebras de linha que um CSV so atrapalharia.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const tipo = new URL(request.url).searchParams.get("tipo");

    if (tipo === "sessoes") return await exportSessions(session.id);
    if (tipo === "biblioteca") return await exportLibrary(session.id);

    return jsonError("Informe tipo=sessoes ou tipo=biblioteca.", 400);
  } catch (error) {
    return serverError("exportar", error);
  }
}

async function exportSessions(userId: string) {
  const rows = await db
    .select({
      createdAt: readingSessions.createdAt,
      title: texts.title,
      wpm: readingSessions.wpm,
      wordsRead: readingSessions.wordsRead,
      durationMs: readingSessions.durationMs,
      completed: readingSessions.completed,
    })
    .from(readingSessions)
    .innerJoin(texts, eq(texts.id, readingSessions.textId))
    .where(eq(readingSessions.userId, userId))
    .orderBy(asc(readingSessions.createdAt));

  const header = ["data", "titulo", "ppm", "palavras", "duracao_segundos", "concluida"];
  const body = rows.map((row) => [
    row.createdAt.toISOString(),
    row.title,
    String(row.wpm),
    String(row.wordsRead),
    String(Math.round(row.durationMs / 1000)),
    row.completed ? "sim" : "nao",
  ]);

  return csv([header, ...body], "leitura-sessoes");
}

async function exportLibrary(userId: string) {
  const [rows, marks] = await Promise.all([
    db.select().from(texts).where(and(eq(texts.userId, userId))).orderBy(asc(texts.createdAt)),
    db
      .select()
      .from(highlights)
      .where(eq(highlights.userId, userId))
      .orderBy(asc(highlights.startIndex)),
  ]);

  const byText = new Map<string, typeof marks>();
  for (const mark of marks) {
    const list = byText.get(mark.textId) ?? [];
    list.push(mark);
    byText.set(mark.textId, list);
  }

  const payload = rows.map((row) => {
    // O trecho vai junto: quem abrir o arquivo fora do app nao tem como
    // reconstruir um intervalo de palavras a partir do indice sozinho.
    const { words } = parseParagraphs(row.content, asTextFormat(row.format));

    return {
      titulo: row.title,
      origem: row.sourceUrl,
      parteDaOrigem: row.sourcePage,
      palavras: row.wordCount,
      progresso: row.progressIndex,
      arquivadoEm: row.archivedAt?.toISOString() ?? null,
      criadoEm: row.createdAt.toISOString(),
      atualizadoEm: row.updatedAt.toISOString(),
      conteudo: row.content,
      formato: row.format,
      destaques: (byText.get(row.id) ?? []).map((mark) => ({
        inicio: mark.startIndex,
        fim: mark.endIndex,
        trecho: excerptOf(words, mark.startIndex, mark.endIndex),
        nota: mark.note,
        criadoEm: mark.createdAt.toISOString(),
      })),
    };
  });

  return download(JSON.stringify(payload, null, 2), "application/json", "leitura-biblioteca.json");
}

/**
 * Monta o CSV com BOM e CRLF.
 *
 * Sem o BOM o Excel abre acentuacao como ruido; sem o CRLF ele nao reconhece a
 * quebra de linha. Os dois so importam porque o destino declarado e planilha.
 */
function csv(rows: string[][], name: string) {
  const text = rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
  return download(`﻿${text}\r\n`, "text/csv; charset=utf-8", `${name}.csv`);
}

function escapeCell(value: string): string {
  // Aspas duplicadas e o campo inteiro entre aspas: e o que permite virgula,
  // aspas e quebra de linha dentro de uma celula.
  return `"${value.replace(/"/g, '""')}"`;
}

function download(body: string, contentType: string, filename: string) {
  return new NextResponse(body, {
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      // Dados da conta nao devem ficar em cache de proxy nenhum.
      "cache-control": "no-store",
    },
  });
}
