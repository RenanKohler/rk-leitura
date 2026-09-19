/**
 * Regras sobre a URL de origem de um texto, compartilhadas pelas rotas de
 * importacao e pela tela de compartilhamento.
 *
 * Funcoes puras: nada de servidor aqui.
 */

/** Parametros de rastreamento - mudam o endereco sem mudar o conteudo. */
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|igshid$|mc_[ce]id$|ref$|ref_src$|si$|s$)/i;

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i;

/**
 * Forma canonica de um endereco, usada para comparar dois textos.
 *
 * Nao serve para exibir: o objetivo e decidir se dois enderecos apontam para o
 * mesmo conteudo. Sem isso, o mesmo conto compartilhado duas vezes - uma pelo
 * navegador, outra por um app que anexa `?utm_source=` - viraria duas entradas
 * na biblioteca.
 */
export function normalizeSourceUrl(raw: string): string {
  const trimmed = raw.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return trimmed;

  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();

  // Copia das chaves antes de apagar: deletar durante a iteracao pula itens.
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) parsed.searchParams.delete(key);
  }

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}

/**
 * Primeiro endereco encontrado no que o sistema compartilhou.
 *
 * O Android nao garante em qual campo a URL chega: o Chrome preenche `url`,
 * mas boa parte dos apps manda tudo junto em `text`. Procurar nos tres evita
 * depender de quem compartilhou.
 */
export function pickSharedUrl(fields: {
  url?: string | null;
  text?: string | null;
  title?: string | null;
}): string | null {
  for (const candidate of [fields.url, fields.text, fields.title]) {
    const found = firstUrl(candidate);
    if (found) return found;
  }
  return null;
}

function firstUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  const match = URL_IN_TEXT.exec(value.trim());
  if (!match) return null;

  // Pontuacao colada no fim do endereco quando ele vem dentro de uma frase.
  // O parentese so sai quando nao ha um abrindo: ha URLs que o usam de verdade.
  let url = match[0].replace(/[.,;:!?]+$/, "");
  if (!url.includes("(")) url = url.replace(/[)\]}]+$/, "");

  return url.length > 0 ? url : null;
}

/**
 * Numero da parte que a URL importada representa; 1 quando nao ha `page`.
 *
 * Importar um endereco que ja aponta para uma parte ("?page=3") significa que
 * a continuacao deve seguir da 4, nao voltar para a 2 - o que traria de novo o
 * que ja esta salvo.
 */
export function pageFromUrl(sourceUrl: string | null): number {
  if (!sourceUrl) return 1;

  try {
    const page = Number(new URL(sourceUrl).searchParams.get("page"));
    return Number.isInteger(page) && page > 1 ? page : 1;
  } catch {
    return 1;
  }
}
