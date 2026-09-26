import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bookmarks, highlights, readingSessions, tags, texts, textTags } from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { excerptOf } from "@/lib/highlights";
import { asTextFormat, parseParagraphs } from "@/lib/reading";
import { BACKUP_KIND, BACKUP_VERSION } from "@/lib/backup";

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
  const [rows, marks, points, labels] = await Promise.all([
    db.select().from(texts).where(and(eq(texts.userId, userId))).orderBy(asc(texts.createdAt)),
    db
      .select()
      .from(highlights)
      .where(eq(highlights.userId, userId))
      .orderBy(asc(highlights.startIndex)),
    db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.userId, userId))
      .orderBy(asc(bookmarks.position)),
    db
      .select({ textId: textTags.textId, name: tags.name })
      .from(textTags)
      .innerJoin(tags, eq(tags.id, textTags.tagId))
      .where(eq(tags.userId, userId)),
  ]);

  const group = <T extends { textId: string }>(items: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of items) map.set(item.textId, [...(map.get(item.textId) ?? []), item]);
    return map;
  };
  const pointsByText = group(points);
  const labelsByText = group(labels);

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
      idioma: row.language,
      etiquetas: (labelsByText.get(row.id) ?? []).map((label) => label.name),
      marcadores: (pointsByText.get(row.id) ?? []).map((point) => ({
        posicao: point.position,
        nome: point.label,
      })),
      destaques: (byText.get(row.id) ?? []).map((mark) => ({
        inicio: mark.startIndex,
        fim: mark.endIndex,
        trecho: excerptOf(words, mark.startIndex, mark.endIndex),
        nota: mark.note,
        criadoEm: mark.createdAt.toISOString(),
      })),
    };
  });

  // Versao 2 (US-98): o envelope identifica o arquivo na restauracao, e os
  // textos trazem idioma, etiquetas e marcadores para voltarem inteiros.
  const file = {
    formato: BACKUP_KIND,
    versao: BACKUP_VERSION,
    exportadoEm: new Date().toISOString(),
    textos: payload,
  };
  return download(JSON.stringify(file, null, 2), "application/json", "leitura-biblioteca.json");
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
