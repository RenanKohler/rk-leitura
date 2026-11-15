import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import type { SeriesChapter } from "@/lib/types";

/**
 * Consultas de serie para o leitor.
 *
 * Fora de `lib/queries.ts` so pelo tamanho, como `learning-queries.ts`. A
 * convencao e a mesma: o que e regra fica em funcoes puras de `lib/`.
 */

/**
 * Os capitulos da serie de um texto, para trocar de capitulo sem sair do
 * leitor (US-226). Texto solto nao tem serie: lista vazia, sem ir ao banco.
 *
 * Mesmo recorte e mesma ordem do cartao da serie na biblioteca
 * (`loadLibrary` e `toLibraryItem`): todos os capitulos do dono, sem filtro
 * de aba nem de estado. Concluir um capitulo o arquiva, e deixar os
 * arquivados de fora tiraria da lista justamente os ja lidos; os largados
 * (US-79) tambem entram la, e aqui vao marcados para a linha nao os mostrar
 * como leitura em andamento.
 *
 * Sem a coluna `content`: um livro de quarenta capitulos traria megabytes
 * para montar uma lista de titulos, a cada abertura do leitor. O indice
 * `texts_user_series_idx` (dono, serie, capitulo) atende o filtro e a ordem.
 */
export async function loadSeriesChapters(
  userId: string,
  seriesKey: string | null
): Promise<SeriesChapter[]> {
  if (!seriesKey) return [];

  const rows = await db
    .select({
      id: texts.id,
      title: texts.title,
      chapter: texts.chapter,
      wordCount: texts.wordCount,
      progressIndex: texts.progressIndex,
      abandonedAt: texts.abandonedAt,
    })
    .from(texts)
    .where(and(eq(texts.userId, userId), eq(texts.seriesKey, seriesKey)))
    .orderBy(asc(texts.chapter), desc(texts.createdAt));

  return (
    rows
      // Capitulo sem numero conta como zero e vem primeiro, como na
      // biblioteca. A ordenacao e estavel: o empate fica como o banco deixou.
      .sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0))
      .map(({ abandonedAt, ...row }) => ({ ...row, abandoned: abandonedAt !== null }))
  );
}
