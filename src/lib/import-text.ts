import "server-only";

import type { Language } from "@/lib/language";
import { extractTextFromHtml, type Extraction } from "@/lib/parser";
import { fetchPublicHtml, SafeFetchError } from "@/lib/safe-fetch";
import { collectPages } from "@/lib/continuation";
import { fetchNextPart } from "@/lib/next-part";
import { countWords } from "@/lib/reading";
import { pageFromUrl } from "@/lib/source-url";

/**
 * Busca e extracao de um texto a partir de uma URL.
 *
 * Vive fora das rotas porque duas precisam dela: `/api/import-url`, que so
 * devolve a previa, e `/api/share`, que importa e salva em uma chamada so.
 */

const MIN_WORDS = 10;

export interface ImportedDocument {
  title: string;
  content: string;
  wordCount: number;
  /** Endereco final, depois dos redirecionamentos. */
  sourceUrl: string;
  /** Idioma declarado pela pagina; null quando ela nao declara. */
  language: Language | null;
  /** Corpo declarado pela pagina ou palpite pelo maior container (US-136). */
  extraction: Extraction;
  /** Autor declarado pela pagina; null quando ela nao declara (US-152). */
  author: string | null;
}

/** Falha esperada da importacao, com o status que a rota deve devolver. */
export class ImportError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Falha passageira da origem (5xx, 429, tempo esgotado): vale tentar de novo. */
    readonly retryable = false
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export async function importFromUrl(url: string): Promise<ImportedDocument> {
  try {
    const { html, finalUrl } = await fetchPublicHtml(url);
    const parsed = extractTextFromHtml(html);

    if (parsed.wordCount < MIN_WORDS) {
      throw new ImportError("Não encontrei texto suficiente nessa página.", 422);
    }

    return {
      title: parsed.title,
      content: parsed.content,
      wordCount: parsed.wordCount,
      sourceUrl: finalUrl,
      language: parsed.language,
      extraction: parsed.extraction,
      author: parsed.author,
    };
  } catch (error) {
    if (error instanceof ImportError) throw error;
    // 404 da origem passa adiante: para quem busca o capitulo seguinte, e o
    // sinal de que ele ainda nao foi publicado, e nao uma falha.
    if (error instanceof SafeFetchError) {
      const passing = error.status !== undefined && (error.status >= 500 || error.status === 429);
      throw new ImportError(error.message, error.status === 404 ? 404 : 400, passing);
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ImportError("A página demorou demais para responder.", 504, true);
    }
    throw error;
  }
}

/** Importacao de um texto em partes, com todas as paginas juntas. */
export interface ImportedAllPages extends ImportedDocument {
  pages: {
    first: number;
    last: number;
    complete: boolean;
    /** Por que parou antes do fim; vazio quando `complete`. */
    stopMessage: string;
  };
}

/**
 * Importa a pagina pedida e as seguintes (`?page=`), ate a origem acabar.
 *
 * A primeira pagina falha como a importacao comum; as seguintes nunca viram
 * erro: o que veio e devolvido com o motivo da parada, e o resto pode ser
 * buscado depois com "Continuar".
 */
export async function importAllPages(url: string): Promise<ImportedAllPages> {
  const first = await importFromUrl(url);
  const collected = await collectPages(
    { content: first.content, page: pageFromUrl(first.sourceUrl) },
    async (page, existing) => fetchNextPart(first.sourceUrl, page, existing)
  );

  return {
    ...first,
    content: collected.content,
    wordCount: countWords(collected.content),
    pages: {
      first: collected.firstPage,
      last: collected.lastPage,
      complete: collected.complete,
      stopMessage: collected.stopMessage,
    },
  };
}
