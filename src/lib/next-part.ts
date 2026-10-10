import "server-only";

import { alreadyPresent, buildPageUrl } from "@/lib/continuation";
import { extractTextFromHtml } from "@/lib/parser";
import { fetchPublicHtml, SafeFetchError } from "@/lib/safe-fetch";

/** Abaixo disso a pagina buscada nao e uma parte do texto. */
const MIN_WORDS = 10;

export type NextPart =
  | { status: "appended"; page: number; content: string }
  | { status: "end" | "unavailable" | "no-source"; page: number; message: string };

/**
 * Busca a parte `page` de um texto servido em partes com `?page=`.
 *
 * Usada pela continuacao de um texto salvo e pela importacao de todas as
 * paginas. A base e sempre a URL importada, nunca a da ultima busca, para nao
 * acumular parametros. `existing` e o que ja foi trazido: uma origem que
 * ignora `?page=` devolve a primeira parte de novo, e isso e o fim, nao uma
 * parte nova.
 */
export async function fetchNextPart(
  sourceUrl: string,
  page: number,
  existing: string
): Promise<NextPart> {
  const target = buildPageUrl(sourceUrl, page);
  if (!target) {
    return { status: "no-source", page, message: "A origem deste texto não é um endereço válido." };
  }

  let html: string;
  try {
    ({ html } = await fetchPublicHtml(target));
  } catch (error) {
    return endOrUnavailable(error, page);
  }

  let parsed;
  try {
    parsed = extractTextFromHtml(html);
  } catch (error) {
    console.error("[proxima-parte] falha ao interpretar o HTML:", error);
    return { status: "unavailable", page, message: "Não consegui interpretar a próxima parte." };
  }

  if (parsed.wordCount < MIN_WORDS) {
    return { status: "end", page, message: "Não há mais partes neste texto." };
  }

  if (alreadyPresent(existing, parsed.content)) {
    return {
      status: "end",
      page,
      message: "A origem repetiu a parte anterior: não há mais páginas.",
    };
  }

  return { status: "appended", page, content: parsed.content };
}

/**
 * 404 e 410 na proxima parte significam que o texto acabou, nao que algo
 * deu errado. Qualquer outra falha e indisponibilidade temporaria.
 */
function endOrUnavailable(error: unknown, page: number): NextPart {
  if (error instanceof SafeFetchError) {
    if (error.status === 404 || error.status === 410) {
      return { status: "end", page, message: "Não há mais partes neste texto." };
    }
    return { status: "unavailable", page, message: error.message };
  }

  if (error instanceof Error && error.name === "TimeoutError") {
    return { status: "unavailable", page, message: "A origem demorou demais para responder." };
  }

  console.error("[proxima-parte] falha inesperada na busca:", error);
  return { status: "unavailable", page, message: "Não consegui buscar a próxima parte." };
}
