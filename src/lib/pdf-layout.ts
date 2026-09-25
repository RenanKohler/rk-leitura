/**
 * Ordem de leitura e estrutura de uma pagina de PDF.
 *
 * O PDF so informa onde cada pedaco de texto e desenhado. Juntar tudo o que
 * esta na mesma altura funciona para uma coluna, mas em um artigo de duas
 * colunas cola a linha da esquerda na da direita e o texto vira uma mistura
 * das duas. Aqui a pagina e dividida pelos corredores em branco entre as
 * colunas (corte XY): cada coluna e lida de cima para baixo, da esquerda para
 * a direita, e os blocos de largura cheia (titulo, resumo) ficam onde estao.
 *
 * Depois, os paragrafos e titulos sao remontados pela geometria - recuo,
 * espaco entre linhas, linha curta no fim do paragrafo, corpo da fonte - e o
 * resultado sai em Markdown, para o leitor mostrar os titulos como titulos.
 *
 * Funcoes puras, testaveis sem pdf.js.
 */
import { dropRepeated } from "@/lib/pdf-text";

/** Um pedaco de texto como o pdf.js o entrega, ja em coordenadas da pagina. */
export interface PdfItem {
  text: string;
  /** Canto esquerdo da linha de base. */
  x: number;
  /** Linha de base; no PDF o eixo y cresce para cima. */
  y: number;
  /** Largura desenhada; 0 quando o pdf.js nao informa. */
  width: number;
  /** Corpo da fonte. */
  size: number;
}

/** Uma linha de texto ja montada, dentro de um bloco. */
export interface PdfLine {
  text: string;
  x: number;
  right: number;
  y: number;
  size: number;
  /** Bloco (coluna ou faixa) da pagina a que a linha pertence. */
  block: number;
}

/** Limites horizontais de um bloco: servem para ver recuo e linha curta. */
export interface PdfBlock {
  left: number;
  right: number;
  /** Distancia tipica entre linhas do bloco. */
  pitch: number;
}

export interface PdfPage {
  lines: PdfLine[];
  blocks: PdfBlock[];
}

/* --- geometria ------------------------------------------------------------- */

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Largura do pedaco; estimada pelo numero de letras quando falta. */
function widthOf(item: PdfItem): number {
  return item.width > 0 ? item.width : item.text.length * item.size * 0.5;
}

const rightOf = (item: PdfItem) => item.x + widthOf(item);

/**
 * Agrupa os pedacos em linhas visuais. A tolerancia acompanha o corpo da
 * fonte: um expoente ("Esterman^1") fica um terco de letra acima da linha e
 * continua nela.
 */
function rowsOf(items: PdfItem[]): PdfItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; size: number; items: PdfItem[] }[] = [];

  for (const item of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - item.y) <= 0.5 * Math.max(row.size, item.size)) {
      row.items.push(item);
      // A ancora da linha e a do maior corpo: a linha de base do texto, nao
      // a do expoente.
      if (item.size > row.size) {
        row.size = item.size;
        row.y = item.y;
      }
    } else {
      rows.push({ y: item.y, size: item.size, items: [item] });
    }
  }

  return rows.map((row) => row.items.sort((a, b) => a.x - b.x));
}

/** Corredores verticais em branco que atravessam a regiao inteira. */
function verticalCuts(items: PdfItem[], minGap: number): number[] {
  const spans = items
    .map((item) => [item.x, rightOf(item)] as const)
    .sort((a, b) => a[0] - b[0]);

  const cuts: number[] = [];
  let reach = spans[0]?.[1] ?? 0;
  for (const [start, end] of spans.slice(1)) {
    if (start - reach >= minGap) cuts.push((start + reach) / 2);
    reach = Math.max(reach, end);
  }
  return cuts;
}

/** Quantas linhas distintas tem pedacos em cada lado do corte. */
function rowsOnBothSides(rows: PdfItem[][], cut: number): [number, number] {
  let left = 0;
  let right = 0;
  for (const row of rows) {
    if (row.some((item) => rightOf(item) <= cut)) left += 1;
    if (row.some((item) => item.x >= cut)) right += 1;
  }
  return [left, right];
}

/**
 * Posicao do corredor entre colunas quando ele nao atravessa a regiao toda -
 * um titulo ou resumo de largura cheia passa por cima dele.
 *
 * Candidatos sao as bordas direitas dos pedacos. Para cada um, conta as
 * linhas que deixam uma faixa vazia de `minGap` ali e tem texto a esquerda,
 * e as que deixam a faixa vazia e tem texto a direita. As colunas nem sempre
 * dividem a mesma linha de base, entao a contagem e por linha, de cada lado,
 * e nao por vao dentro da mesma linha. Vence o candidato com mais linhas no
 * lado mais fraco.
 */
function partialGutter(rows: PdfItem[][], minGap: number): number | null {
  const half = minGap / 2;
  const candidates = [
    ...new Set(rows.flat().map((item) => Math.round(rightOf(item) + half))),
  ];

  let best: { score: number; center: number } | null = null;
  for (const candidate of candidates) {
    let left = 0;
    let right = 0;
    let edgeLeft = -Infinity;
    let edgeRight = Infinity;

    for (const row of rows) {
      if (row.some((item) => item.x < candidate + half && rightOf(item) > candidate - half)) {
        continue;
      }
      const before = row.filter((item) => rightOf(item) <= candidate - half);
      const after = row.filter((item) => item.x >= candidate + half);
      if (before.length > 0) {
        left += 1;
        edgeLeft = Math.max(edgeLeft, ...before.map(rightOf));
      }
      if (after.length > 0) {
        right += 1;
        edgeRight = Math.min(edgeRight, ...after.map((item) => item.x));
      }
    }

    const score = Math.min(left, right);
    if (score > (best?.score ?? 0)) {
      best = { score, center: (edgeLeft + edgeRight) / 2 };
    }
  }

  // Poucas linhas de cada lado e coincidencia de espacamento, nao coluna.
  if (!best || best.score < Math.max(3, Math.ceil(rows.length * 0.15))) return null;
  return best.center;
}

/** A linha passa por cima do corredor (texto de largura cheia). */
const crosses = (row: PdfItem[], x: number, half: number) =>
  row.some((item) => item.x < x + half && rightOf(item) > x - half);

/**
 * Corte XY: devolve as regioes-folha na ordem de leitura. Cada chamada
 * recursiva recebe um subconjunto estrito, entao a recursao termina.
 */
function readingRegions(items: PdfItem[], bodySize: number): PdfItem[][] {
  if (items.length <= 1) return items.length ? [items] : [];

  const minGap = Math.max(4, bodySize * 0.8);
  const rows = rowsOf(items);

  // 1. Corredor que atravessa a regiao toda: colunas, da esquerda para a
  //    direita. Exige texto em mais de uma linha dos dois lados - numa linha
  //    so, o vao entre duas palavras nao e coluna.
  const cuts = verticalCuts(items, minGap).filter((cut) => {
    const [left, right] = rowsOnBothSides(rows, cut);
    return left >= 2 && right >= 2;
  });
  if (cuts.length > 0) {
    const bounds = [-Infinity, ...cuts, Infinity];
    return bounds.slice(1).flatMap((end, index) => {
      const start = bounds[index]!;
      const column = items.filter((item) => {
        const center = (item.x + rightOf(item)) / 2;
        return center >= start && center < end;
      });
      return readingRegions(column, bodySize);
    });
  }

  // 2. Corredor parcial: faixas de cima para baixo, separando as linhas que
  //    passam por cima do corredor (largura cheia) das que nao passam.
  const gutter = partialGutter(rows, minGap);
  if (gutter === null) return [items];

  const bands: PdfItem[][][] = [];
  let previous: boolean | null = null;
  for (const row of rows) {
    const spanning = crosses(row, gutter, minGap / 4);
    if (spanning !== previous) bands.push([]);
    bands[bands.length - 1]!.push(row);
    previous = spanning;
  }

  if (bands.length > 1) {
    return bands.flatMap((band) => readingRegions(band.flat(), bodySize));
  }

  // 3. Uma faixa so, sem linha atravessando, mas com o corredor torto demais
  //    para o corte 1: divide pelo corredor encontrado.
  if (!previous) {
    const [left, right] = rowsOnBothSides(rows, gutter);
    if (left >= 2 && right >= 2) {
      const center = (item: PdfItem) => (item.x + rightOf(item)) / 2;
      return [
        ...readingRegions(items.filter((item) => center(item) < gutter), bodySize),
        ...readingRegions(items.filter((item) => center(item) >= gutter), bodySize),
      ];
    }
  }

  return [items];
}

/** Junta os pedacos de uma linha, com espaco onde o PDF deixou um vao. */
function joinRow(row: PdfItem[]): string {
  let text = "";
  let end: number | null = null;
  for (const item of row) {
    const gap = end === null ? 0 : item.x - end;
    const needsSpace =
      text.length > 0 && gap > item.size * 0.2 && !/\s$/.test(text) && !/^\s/.test(item.text);
    text += (needsSpace ? " " : "") + item.text;
    end = rightOf(item);
  }
  return text.replace(/\s+/g, " ").trim();
}

/** Corpo dominante: o da maior parte das letras. */
function dominantSize(items: PdfItem[]): number {
  const weight = new Map<number, number>();
  for (const item of items) {
    const size = Math.round(item.size * 10) / 10;
    weight.set(size, (weight.get(size) ?? 0) + item.text.trim().length);
  }
  let best = 0;
  let bestWeight = -1;
  for (const [size, count] of weight) {
    if (count > bestWeight) {
      best = size;
      bestWeight = count;
    }
  }
  return best;
}

/**
 * Monta a pagina: linhas na ordem de leitura, cada uma ligada ao bloco de
 * onde veio. `bodySize` e o corpo do texto do documento inteiro.
 */
export function layoutPage(items: PdfItem[], bodySize: number): PdfPage {
  const usable = items.filter((item) => item.text.trim().length > 0);
  const lines: PdfLine[] = [];
  const blocks: PdfBlock[] = [];

  for (const region of readingRegions(usable, bodySize)) {
    const rows = rowsOf(region);
    const regionLines = rows
      .map((row) => {
        const text = joinRow(row);
        const main = row.filter((item) => item.size >= dominantSize(row) * 0.85);
        return {
          text,
          x: Math.min(...row.map((item) => item.x)),
          right: Math.max(...row.map(rightOf)),
          y: (main[0] ?? row[0]!).y,
          size: dominantSize(row),
          block: blocks.length,
        };
      })
      .filter((line) => line.text.length > 0);
    if (regionLines.length === 0) continue;

    const steps = regionLines
      .slice(1)
      .map((line, index) => regionLines[index]!.y - line.y)
      .filter((step) => step > 0);

    blocks.push({
      left: Math.min(...regionLines.map((line) => line.x)),
      right: Math.max(...regionLines.map((line) => line.right)),
      pitch: median(steps) || dominantSize(region) * 1.3,
    });
    lines.push(...regionLines);
  }

  return { lines, blocks };
}

/**
 * Remove cabecalho e rodape corridos antes de montar as colunas.
 *
 * A comparacao precisa ser pela posicao na pagina, nao pela ordem de
 * leitura: um cabecalho alinhado a direita fica sobre a coluna da direita e,
 * depois do corte em colunas, seria lido no meio do texto.
 */
export function stripRunningLines(pages: PdfItem[][]): PdfItem[][] {
  const rowPages = pages.map((items) =>
    rowsOf(items.filter((item) => item.text.trim().length > 0))
  );
  const kept = dropRepeated(rowPages, 2, joinRow);
  return kept.map((rows) => rows.flat());
}

/** Corpo do texto corrido do documento: o que cobre mais letras. */
export function bodySizeOf(pages: PdfItem[][]): number {
  return dominantSize(pages.flat()) || 10;
}

/* --- paragrafos e Markdown ------------------------------------------------- */

const PAGE_NUMBER = /^[\s\-–—|]*\d{1,4}[\s\-–—|]*$/;
const SENTENCE_END = /[.!?…:][")'\]»”’]*$/;
const BULLET = /^[•▪◦●■‣∙·]\s*/;

/**
 * Escapa o que o leitor de Markdown interpretaria como marca. O texto de um
 * PDF e texto: um asterisco ou um "#" nele sao literais.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\`*_[\]<>~|#]/g, (char) => `\\${char}`)
    .replace(/^[-+]/, (char) => `\\${char}`)
    .replace(/^(\d{1,9})([.)])(\s)/, "$1\\$2$3");
}

interface Paragraph {
  kind: "p" | "heading" | "li";
  size: number;
  text: string;
}

/**
 * Remonta paragrafos e titulos a partir das linhas de todas as paginas e
 * devolve o documento em Markdown.
 *
 * Paragrafo novo quando: o corpo da fonte muda (titulo, nota), a linha
 * comeca recuada, ha um espaco maior que o normal entre as linhas, ou a
 * linha anterior termina a frase antes da margem direita. A troca de coluna
 * ou de pagina nao fecha paragrafo por si: a frase costuma continuar no alto
 * da coluna seguinte.
 */
export function pagesToMarkdown(pages: PdfPage[], bodySize: number): string {
  const paragraphs: Paragraph[] = [];
  const isHeading = (line: PdfLine) =>
    line.size >= bodySize * 1.15 && /\p{L}/u.test(line.text) && line.text.length <= 150;

  let current: Paragraph | null = null;
  let previous: { line: PdfLine; block: PdfBlock; page: number } | null = null;

  const flush = () => {
    if (current && current.text.trim()) paragraphs.push(current);
    current = null;
  };

  pages.forEach((page, pageIndex) => {
    for (const line of page.lines) {
      if (PAGE_NUMBER.test(line.text)) continue;
      const block = page.blocks[line.block]!;
      const heading = isHeading(line);
      const bullet = BULLET.test(line.text);
      const text = bullet ? line.text.replace(BULLET, "") : line.text;

      let breakHere = current === null || bullet;
      if (!breakHere && previous) {
        const before = previous.line;
        const sameBlock = previous.page === pageIndex && before.block === line.block;
        const size = Math.max(before.size, line.size);
        const sizeChanged = Math.abs(before.size - line.size) / size > 0.12;
        const shortBefore =
          SENTENCE_END.test(before.text) && before.right < previous.block.right - size * 1.5;
        const indented = line.x - block.left > size * 0.8 && block.right - block.left > size * 10;
        const gap = before.y - line.y;
        // So compara o espaco quando a linha vem abaixo da anterior: na troca
        // de coluna ela volta para o alto da pagina.
        // A distancia tipica do bloco, limitada a uma faixa plausivel para o
        // corpo: num bloco curto a mediana mistura titulo e texto.
        const pitch = Math.min(
          Math.max(block.pitch, previous.block.pitch, size * 1.2),
          size * 1.8
        );
        const wideGap = gap > 0 && previous.page === pageIndex && gap > pitch * 1.5;

        breakHere =
          sizeChanged ||
          heading !== (current!.kind === "heading") ||
          shortBefore ||
          (indented && !(sameBlock && before.x - block.left > size * 0.8)) ||
          wideGap;
      }

      if (breakHere) {
        flush();
        current = { kind: heading ? "heading" : bullet ? "li" : "p", size: line.size, text };
      } else if (/\p{L}-$/u.test(current!.text)) {
        // Hifenizacao de fim de linha: "recomen-" + "dado".
        current!.text = current!.text.slice(0, -1) + text;
      } else {
        current!.text = `${current!.text} ${text}`;
      }

      previous = { line, block, page: pageIndex };
    }
  });
  flush();

  // Niveis de titulo pelo corpo: o maior e o titulo do documento.
  const headingSizes = [
    ...new Set(paragraphs.filter((p) => p.kind === "heading").map((p) => Math.round(p.size))),
  ].sort((a, b) => b - a);
  const levelOf = (size: number) =>
    "#".repeat(Math.min(3, headingSizes.indexOf(Math.round(size)) + 1));

  return paragraphs
    .map((paragraph) => {
      const text = escapeMarkdown(paragraph.text.replace(/\s+/g, " ").trim());
      if (paragraph.kind === "heading") return `${levelOf(paragraph.size)} ${text}`;
      if (paragraph.kind === "li") return `- ${text}`;
      return text;
    })
    .join("\n\n");
}
