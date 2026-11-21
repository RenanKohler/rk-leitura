import "server-only";

import type { Language } from "@/lib/language";
import { extractTextFromHtml, type Extraction } from "@/lib/parser";
import { fetchPublicHtml, SafeFetchError } from "@/lib/safe-fetch";
import { collectPages } from "@/lib/continuation";
import { fetchNextPart, partFromHtml } from "@/lib/next-part";
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

/**
 * Extrai o texto de um HTML ja em maos: o buscado pelo servidor ou o enviado
 * pelo navegador ("Enviar para o Leitura"), quando o site recusa o servidor.
 */
export function documentFromHtml(html: string, sourceUrl: string): ImportedDocument {
  const parsed = extractTextFromHtml(html);

  if (parsed.wordCount < MIN_WORDS) {
    throw new ImportError("Não encontrei texto suficiente nessa página.", 422);
  }

  return {
    title: parsed.title,
    content: parsed.content,
    wordCount: parsed.wordCount,
    sourceUrl,
    language: parsed.language,
    extraction: parsed.extraction,
    author: parsed.author,
  };
}

export async function importFromUrl(url: string): Promise<ImportedDocument> {
  try {
    const { html, finalUrl } = await fetchPublicHtml(url);
    return documentFromHtml(html, finalUrl);
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

/** O navegador parou de juntar paginas pelo tamanho do envio. */
export const RECEIVED_PARTIAL =
  "O navegador parou de juntar páginas pelo tamanho do envio. Envie de novo a partir da página seguinte.";

/**
 * Monta o texto com as paginas que o navegador enviou ("Enviar para o
 * Leitura"): a primeira e as seguintes, na ordem, com as mesmas regras da
 * importacao de todas as paginas. Nada e buscado na rede.
 *
 * `partial` diz que o navegador parou antes do fim por tamanho: acabar as
 * paginas enviadas, nesse caso, nao e o fim do texto.
 */
export async function importReceivedPages(
  url: string,
  pages: readonly string[],
  partial = false
): Promise<ImportedDocument | ImportedAllPages> {
  const [firstHtml, ...rest] = pages;
  if (firstHtml === undefined) throw new ImportError("Nenhuma página recebida.", 400);

  const first = documentFromHtml(firstHtml, url);
  if (rest.length === 0) return first;

  const firstPage = pageFromUrl(url);
  const collected = await collectPages(
    { content: first.content, page: firstPage },
    async (page, existing) => {
      const html = rest[page - firstPage - 1];
      if (html === undefined) {
        return partial
          ? { status: "unavailable", message: RECEIVED_PARTIAL }
          : { status: "end", message: "Não há mais partes neste texto." };
      }
      const part = partFromHtml(html, page, existing);
      return part.status === "appended"
        ? { status: "appended", content: part.content }
        : { status: part.status, message: part.message };
    },
    // Sem rede, o tempo nao pesa: o limite e o que o navegador enviou.
    { budgetMs: Number.POSITIVE_INFINITY }
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
