import "server-only";

import type { Language } from "@/lib/language";
import { extractTextFromHtml } from "@/lib/parser";
import { fetchPublicHtml, SafeFetchError } from "@/lib/safe-fetch";

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
}

/** Falha esperada da importacao, com o status que a rota deve devolver. */
export class ImportError extends Error {
  constructor(
    message: string,
    readonly status: number
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
      throw new ImportError("Nao encontrei texto suficiente nessa pagina.", 422);
    }

    return {
      title: parsed.title,
      content: parsed.content,
      wordCount: parsed.wordCount,
      sourceUrl: finalUrl,
      language: parsed.language,
    };
  } catch (error) {
    if (error instanceof ImportError) throw error;
    // 404 da origem passa adiante: para quem busca o capitulo seguinte, e o
    // sinal de que ele ainda nao foi publicado, e nao uma falha.
    if (error instanceof SafeFetchError) {
      throw new ImportError(error.message, error.status === 404 ? 404 : 400);
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ImportError("A pagina demorou demais para responder.", 504);
    }
    throw error;
  }
}
