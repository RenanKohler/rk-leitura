/**
 * Documento do Word (.docx) em Markdown (US-99).
 *
 * O .docx e um zip; o texto fica em `word/document.xml`, e o tipo de cada
 * lista em `word/numbering.xml`. A leitura roda no navegador, como a de PDF e
 * EPUB: so o texto extraido vai ao servidor.
 *
 * O XML do Word e regular o bastante para ser percorrido por expressoes: um
 * paragrafo e `<w:p>`, um trecho de texto com a mesma formatacao e `<w:r>`.
 * Funcoes puras, testaveis sem navegador.
 */

export const MAX_DOCX_BYTES = 10 * 1024 * 1024;

export class DocxError extends Error {}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Liga/desliga de uma propriedade booleana do Word (`<w:b/>`, `<w:b w:val="0"/>`). */
function flag(props: string, tag: "b" | "i" | "strike"): boolean {
  const match = new RegExp(`<w:${tag}(?:\\s+w:val="([^"]*)")?\\s*/>`).exec(props);
  if (!match) return false;
  const value = match[1];
  return value === undefined || !/^(0|false|off|none)$/i.test(value);
}

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
}

function runsOf(paragraph: string): Run[] {
  const runs: Run[] = [];
  for (const [run] of paragraph.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)) {
    const props = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1] ?? "";
    let text = "";
    for (const [piece] of run.matchAll(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:t\s*\/>|<w:tab\s*\/>|<w:br\b[^>]*\/>/g)) {
      if (piece.startsWith("<w:tab") || piece.startsWith("<w:br")) text += " ";
      else text += decode(piece.replace(/^<w:t\b[^>]*>|<\/w:t>$/g, "").replace(/^<w:t\s*\/>$/, ""));
    }
    if (text) runs.push({ text, bold: flag(props, "b"), italic: flag(props, "i") });
  }
  return runs;
}

/** Texto do paragrafo com negrito e italico em Markdown. */
function inline(runs: Run[]): string {
  // Trechos vizinhos com a mesma formatacao viram um so: o Word parte o
  // texto por qualquer motivo (revisao, idioma), e "**a****b**" quebraria.
  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last && last.bold === run.bold && last.italic === run.italic) last.text += run.text;
    else merged.push({ ...run });
  }

  return merged
    .map(({ text, bold, italic }) => {
      if (!bold && !italic) return text;
      // Os espacos das pontas ficam fora da marca: "** texto**" nao e negrito.
      const [, lead = "", core = "", tail = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];
      if (!core) return text;
      const mark = bold && italic ? "***" : bold ? "**" : "*";
      return `${lead}${mark}${core}${mark}${tail}`;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Formato de cada nivel de cada lista: `numId:nivel` -> numerada ou nao. */
export function parseNumbering(xml: string | null): Map<string, boolean> {
  const ordered = new Map<string, boolean>();
  if (!xml) return ordered;

  const abstract = new Map<string, Map<string, boolean>>();
  for (const match of xml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const id = match[1]!;
    const block = match[2]!;
    const levels = new Map<string, boolean>();
    for (const level of block.matchAll(/<w:lvl\b[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) {
      const format = /<w:numFmt w:val="([^"]+)"/.exec(level[2]!)?.[1] ?? "bullet";
      levels.set(level[1]!, format !== "bullet" && format !== "none");
    }
    abstract.set(id, levels);
  }

  for (const num of xml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)) {
    const abstractId = /<w:abstractNumId w:val="(\d+)"/.exec(num[2]!)?.[1];
    const levels = abstractId ? abstract.get(abstractId) : undefined;
    for (const [level, isOrdered] of levels ?? []) ordered.set(`${num[1]}:${level}`, isOrdered);
  }
  return ordered;
}

function headingLevel(style: string | undefined): number {
  if (!style) return 0;
  if (/^(title|titulo)$/i.test(style)) return 1;
  const match = /^(?:heading|titulo|ttulo|cabealho|cabecalho)\s*(\d)$/i.exec(style.replace(/[^a-z0-9]/gi, ""));
  const level = match ? Number(match[1]) : 0;
  return level >= 1 ? Math.min(level, 3) : 0;
}

function paragraphMarkdown(xml: string, numbering: Map<string, boolean>, counters: Map<string, number>): string | null {
  const props = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(xml)?.[1] ?? "";
  const text = inline(runsOf(xml));
  if (!text) return null;

  const level = headingLevel(/<w:pStyle w:val="([^"]+)"/.exec(props)?.[1]);
  if (level > 0) return `${"#".repeat(level)} ${text.replace(/\*+/g, "")}`;

  const numId = /<w:numId w:val="(\d+)"/.exec(props)?.[1];
  if (numId && numId !== "0") {
    const ilvl = /<w:ilvl w:val="(\d+)"/.exec(props)?.[1] ?? "0";
    const key = `${numId}:${ilvl}`;
    if (numbering.get(key)) {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return `${next}. ${text}`;
    }
    return `- ${text}`;
  }

  counters.clear();
  return text;
}

/** Converte `document.xml` (e `numbering.xml`, se houver) em Markdown. */
export function docxToMarkdown(documentXml: string, numberingXml: string | null = null): string {
  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(documentXml)?.[1];
  if (body === undefined) throw new DocxError("Nao foi possivel ler o documento.");

  const numbering = parseNumbering(numberingXml);
  const counters = new Map<string, number>();
  const blocks: string[] = [];

  for (const [block] of body.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    if (block.startsWith("<w:tbl")) {
      // Tabela vira uma linha por linha da tabela, celulas separadas por " | ".
      counters.clear();
      for (const [row] of block.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
        const cells = [...row.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)]
          .map(([cell]) =>
            [...cell.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(([p]) => inline(runsOf(p))).filter(Boolean).join(" ")
          )
          .filter(Boolean);
        if (cells.length > 0) blocks.push(cells.join(" | "));
      }
      continue;
    }
    const markdown = paragraphMarkdown(block, numbering, counters);
    if (markdown) blocks.push(markdown);
  }

  return blocks.join("\n\n");
}

/** Titulo gravado nas propriedades do documento, quando existe. */
export function docxTitle(coreXml: string | null): string | null {
  const title = coreXml ? /<dc:title>([\s\S]*?)<\/dc:title>/.exec(coreXml)?.[1] : undefined;
  const clean = title ? decode(title).trim() : "";
  return clean.length > 0 ? clean.slice(0, 200) : null;
}
