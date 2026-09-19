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

/** Um pedaco de texto com a posicao em que o PDF o desenha. */
export interface TextItem {
  text: string;
  x: number;
  y: number;
}

/**
 * Junta os pedacos que estao na mesma linha.
 *
 * "Mesma linha" e uma faixa de altura, nao um valor exato: o PDF posiciona
 * cada pedaco de forma independente, e uma palavra em italico no meio da
 * frase costuma ficar uma fracao de ponto acima das vizinhas.
 */
export function linesFromItems(items: TextItem[], tolerance = 2): string[] {
  const rows: { y: number; items: TextItem[] }[] = [];

  for (const item of items) {
    if (item.text.trim().length === 0) continue;
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }

  // De cima para baixo: no PDF o eixo y cresce para cima.
  rows.sort((a, b) => b.y - a.y);

  return rows
    .map((row) =>
      row.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join("")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((line) => line.length > 0);
}

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
export function dropRepeated(pages: string[][], edge = 2): string[][] {
  if (pages.length < 3) return pages;

  // Em uma pagina curta, duas linhas em cima e duas embaixo sao a pagina
  // inteira: tratar tudo como borda apagaria o texto junto com o cabecalho.
  const bandOf = (page: string[]) => (page.length <= edge * 2 ? 1 : edge);

  const counts = new Map<string, number>();
  for (const page of pages) {
    const band = bandOf(page);
    const borders = new Set([...page.slice(0, band), ...page.slice(-band)]);
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
      return !repeated.has(fingerprint(line));
    });
  });
}

/** Linha que e so o numero da pagina. */
const PAGE_NUMBER = /^[\s\-–—|]*\d{1,4}[\s\-–—|]*$/;

/** Fim de paragrafo: pontuacao terminal, com fecho de aspas depois. */
const SENTENCE_END = /[.!?…:][")'\]»”’]*$/;

/**
 * Remonta os paragrafos a partir das linhas.
 *
 * Uma linha que nao termina em pontuacao continua na seguinte: no PDF a
 * quebra de linha e so onde a margem chegou. A hifenizacao de fim de linha e
 * desfeita, senao "recomen-" e "dado" viram duas palavras.
 */
export function joinParagraphs(pages: string[][]): string {
  const paragraphs: string[] = [];
  let current = "";

  const flush = () => {
    const text = current.replace(/\s+/g, " ").trim();
    if (text.length > 0) paragraphs.push(text);
    current = "";
  };

  for (const page of pages) {
    for (const raw of page) {
      const line = raw.trim();
      if (line.length === 0 || PAGE_NUMBER.test(line)) {
        flush();
        continue;
      }

      if (current.length === 0) {
        current = line;
      } else if (current.endsWith("-")) {
        current = current.slice(0, -1) + line;
      } else {
        current = `${current} ${line}`;
      }

      if (SENTENCE_END.test(line)) flush();
    }
    // Quebra de pagina nao fecha paragrafo: a frase costuma atravessar.
  }

  flush();
  return paragraphs.join("\n\n");
}

/** Titulo dos metadados, ou o nome do arquivo sem extensao. */
export function fileTitle(metaTitle: unknown, filename: string): string {
  const fromMeta = typeof metaTitle === "string" ? metaTitle.trim() : "";
  // Muito PDF traz no titulo o que o gerador tinha a mao: o caminho do
  // arquivo, o endereco da pagina impressa, ou "untitled". Nenhum desses e o
  // nome do documento, e o nome do arquivo quase sempre e melhor.
  const junk = /^untitled$|^about:|:\/\/|\.(pdf|docx?|tex|html?)$|[\\/]/i;
  if (fromMeta.length > 2 && !junk.test(fromMeta)) {
    return fromMeta.slice(0, 200);
  }

  return (
    filename
      .replace(/\.pdf$/i, "")
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
