/**
 * Extracao de texto de PDF.
 *
 * Um PDF nao tem paragrafos: tem pedacos de texto com coordenadas. Tudo o que
 * o leitor ve como estrutura - linha, paragrafo, cabecalho que se repete - e
 * reconstruido aqui a partir da posicao de cada pedaco.
 *
 * Funcoes puras: a leitura do arquivo em si fica no cliente, com pdf.js, para
 * nao esbarrar no limite de corpo e de tempo das funcoes serverless. O arquivo
 * nunca e guardado - so o texto extraido.
 */

/** Teto de conteudo aceito pela rota de criacao de texto. */
export const MAX_IMPORT_CHARS = 400_000;

/** Limite do arquivo enviado, antes de qualquer processamento. */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** Forma comparavel de uma linha: numeros viram marcador, caixa e acento somem. */
function fingerprint(line: string): string {
  return line
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove cabecalhos e rodapes que se repetem.
 *
 * A comparacao ignora o numero, entao "12" e "13" no rodape sao a mesma
 * linha, e "Capitulo 3 | 47" tambem. So as bordas da pagina sao examinadas:
 * uma frase repetida no meio do texto e conteudo, nao decoracao.
 */
export function dropRepeated<T = string>(
  pages: T[][],
  edge = 2,
  textOf: (line: T) => string = String
): T[][] {
  if (pages.length < 3) return pages;

  // Em uma pagina curta, duas linhas em cima e duas embaixo sao a pagina
  // inteira: tratar tudo como borda apagaria o texto junto com o cabecalho.
  const bandOf = (page: T[]) => (page.length <= edge * 2 ? 1 : edge);

  const counts = new Map<string, number>();
  for (const page of pages) {
    const band = bandOf(page);
    const borders = new Set([...page.slice(0, band), ...page.slice(-band)].map(textOf));
    for (const line of borders) {
      const key = fingerprint(line);
      if (key.length === 0) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  // Em mais da metade das paginas: e parte do layout, nao do texto.
  const threshold = Math.max(2, Math.ceil(pages.length / 2));
  const repeated = new Set(
    [...counts.entries()].filter(([, count]) => count >= threshold).map(([key]) => key)
  );

  return pages.map((page) => {
    const band = bandOf(page);
    return page.filter((line, index) => {
      const atEdge = index < band || index >= page.length - band;
      if (!atEdge) return true;
      return !repeated.has(fingerprint(textOf(line)));
    });
  });
}

/**
 * Titulo dos metadados, quando e mesmo um titulo.
 *
 * Muito PDF traz no titulo o que o gerador tinha a mao: o caminho do
 * arquivo, o endereco da pagina impressa, ou "untitled". Nenhum desses e o
 * nome do documento.
 */
export function usableMetaTitle(metaTitle: unknown): string | null {
  const fromMeta = typeof metaTitle === "string" ? metaTitle.trim() : "";
  const junk = /^untitled$|^about:|:\/\/|\.(pdf|docx?|tex|html?)$|[\\/]/i;
  return fromMeta.length > 2 && !junk.test(fromMeta) ? fromMeta.slice(0, 200) : null;
}

/** Titulo dos metadados, ou o nome do arquivo sem extensao. */
export function fileTitle(metaTitle: unknown, filename: string): string {
  const fromMeta = usableMetaTitle(metaTitle);
  if (fromMeta) return fromMeta;

  return (
    filename
      .replace(/\.(pdf|md|markdown)$/i, "")
      .replace(/[_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200) || "Documento"
  );
}

/** Verdadeiro quando o PDF nao tem camada de texto para extrair. */
export function hasNoText(content: string): boolean {
  return content.replace(/\s/g, "").length < 50;
}
