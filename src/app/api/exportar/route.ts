import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  aiResults,
  askTurns,
  bookmarks,
  feeds,
  highlights,
  quizRecalls,
  readingGoals,
  readingSessions,
  reviewAnswers,
  savedWords,
  seriesFollows,
  speedSettings,
  studyCards,
  tags,
  texts,
  textTags,
  trainingDays,
  trainingPrograms,
  users,
} from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { excerptOf } from "@/lib/highlights";
import { asTextFormat, parseParagraphs } from "@/lib/reading";
import { BACKUP_KIND, BACKUP_VERSION } from "@/lib/backup";
import { quotedCell } from "@/lib/csv";
import { ACCOUNT_EXPORT_TABLES } from "@/lib/export-coverage";

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
    if (tipo === "biblioteca") return await exportLibrary(session.id, false);
    // Portabilidade (US-189): a biblioteca e tudo o mais que a conta guarda.
    if (tipo === "conta") return await exportLibrary(session.id, true);

    return jsonError("Informe tipo=sessões, tipo=biblioteca ou tipo=conta.", 400);
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

async function exportLibrary(userId: string, full: boolean) {
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
      // O id liga o texto as linhas do bloco `conta` (sessoes, cartoes...).
      id: row.id,
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
      // Versao 3 (US-189): sem isto a restauracao perdia autor, serie e
      // capitulo, e um texto largado voltava como em andamento.
      autor: row.author,
      serie: row.seriesKey
        ? { chave: row.seriesKey, titulo: row.seriesTitle, capitulo: row.chapter }
        : null,
      largadoEm: row.abandonedAt?.toISOString() ?? null,
      palavrasRestantes: row.abandonedWords,
      secoes: row.sections,
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
    ...(full ? { conta: await accountBlock(userId) } : {}),
  };
  return download(
    JSON.stringify(file, null, 2),
    "application/json",
    full ? "leitura-conta.json" : "leitura-biblioteca.json"
  );
}

/** Linha sem a coluna da conta: o arquivo e todo da mesma pessoa. */
function withoutUser<T extends { userId?: string }>(rows: T[]): Omit<T, "userId">[] {
  return rows.map((row) => {
    const { userId: _userId, ...rest } = row;
    void _userId;
    return rest;
  });
}

/**
 * O restante da conta (US-189), uma lista por tabela, com o nome do banco.
 * As linhas ligadas a texto trazem o `textId`, o mesmo `id` de `textos`.
 */
async function accountBlock(userId: string) {
  const [profile] = await db
    .select({ nome: users.name, email: users.email, criadoEm: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const programs = await db.select().from(trainingPrograms).where(eq(trainingPrograms.userId, userId));
  const programIds = programs.map((program) => program.id);

  const rows: Record<(typeof ACCOUNT_EXPORT_TABLES)[number], unknown[]> = {
    reading_sessions: withoutUser(
      await db.select().from(readingSessions).where(eq(readingSessions.userId, userId))
    ),
    speed_settings: withoutUser(await db.select().from(speedSettings).where(eq(speedSettings.userId, userId))),
    reading_goals: withoutUser(await db.select().from(readingGoals).where(eq(readingGoals.userId, userId))),
    training_programs: withoutUser(programs),
    training_days:
      programIds.length > 0
        ? await db.select().from(trainingDays).where(inArray(trainingDays.programId, programIds))
        : [],
    saved_words: withoutUser(await db.select().from(savedWords).where(eq(savedWords.userId, userId))),
    review_answers: withoutUser(await db.select().from(reviewAnswers).where(eq(reviewAnswers.userId, userId))),
    series_follows: withoutUser(await db.select().from(seriesFollows).where(eq(seriesFollows.userId, userId))),
    feeds: withoutUser(await db.select().from(feeds).where(eq(feeds.userId, userId))),
    ai_results: withoutUser(await db.select().from(aiResults).where(eq(aiResults.userId, userId))),
    study_cards: withoutUser(await db.select().from(studyCards).where(eq(studyCards.userId, userId))),
    quiz_recalls: withoutUser(await db.select().from(quizRecalls).where(eq(quizRecalls.userId, userId))),
    ask_turns: withoutUser(await db.select().from(askTurns).where(eq(askTurns.userId, userId))),
  };

  return { perfil: profile ?? null, tabelas: rows };
}

/**
 * Monta o CSV com BOM e CRLF.
 *
 * Sem o BOM o Excel abre acentuacao como ruido; sem o CRLF ele nao reconhece a
 * quebra de linha. Os dois so importam porque o destino declarado e planilha.
 */
function csv(rows: string[][], name: string) {
  const text = rows.map((row) => row.map(quotedCell).join(",")).join("\r\n");
  return download(`﻿${text}\r\n`, "text/csv; charset=utf-8", `${name}.csv`);
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
