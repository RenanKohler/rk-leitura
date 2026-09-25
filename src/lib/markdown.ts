/**
 * Leitura de textos em Markdown.
 *
 * O leitor trabalha com uma lista corrida de palavras: e por ela que andam a
 * posicao salva, os destaques, a selecao e o modo Foco. Por isso o Markdown
 * nao vira HTML: vira as mesmas palavras limpas que um texto simples daria,
 * mais o estilo de cada palavra e o tipo de cada bloco. Os simbolos de
 * formatacao (`#`, `**`, `>`, `-`...) nunca entram na contagem.
 *
 * Cobre o que aparece em anotacoes e artigos: titulos (ATX e setext),
 * citacoes, listas com e sem numero, blocos de codigo, tabelas simples,
 * negrito, italico, codigo, riscado e links. HTML embutido perde as tags e
 * fica o texto.
 */

/** Estilo de uma palavra, em bits: uma palavra pode ser negrito e italico. */
export const STYLE = {
  bold: 1,
  italic: 2,
  code: 4,
  strike: 8,
  link: 16,
  /** Palavra de titulo: o modo Foco a mostra em negrito. */
  heading: 32,
} as const;

/**
 * Classes CSS de um estilo. O titulo fica de fora: quem o formata e o bloco
 * (`data-kind`), nao a palavra.
 */
export function styleClass(style: number): string {
  const classes: string[] = [];
  if (style & STYLE.bold) classes.push("md-bold");
  if (style & STYLE.italic) classes.push("md-italic");
  if (style & STYLE.code) classes.push("md-code");
  if (style & STYLE.strike) classes.push("md-strike");
  if (style & STYLE.link) classes.push("md-link");
  return classes.join(" ");
}

export type BlockKind = "p" | "h1" | "h2" | "h3" | "quote" | "li" | "oli" | "code";

export interface MarkdownBlock {
  kind: BlockKind;
  /** Numero do item em lista numerada ("3."). */
  marker?: string;
  words: string[];
  /** Estilo de cada palavra, na mesma ordem de `words`. */
  styles: number[];
}

/* --- blocos ---------------------------------------------------------------- */

interface RawBlock {
  kind: BlockKind;
  marker?: string;
  text: string;
}

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const SETEXT_1 = /^\s{0,3}=+\s*$/;
const SETEXT_2 = /^\s{0,3}-+\s*$/;

function headingKind(level: number): BlockKind {
  return level === 1 ? "h1" : level === 2 ? "h2" : "h3";
}

/** Separa o documento em blocos, cada um com o texto ainda com marcas inline. */
function splitBlocks(source: string): RawBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: RawBlock[] = [];

  let buffer: string[] = [];
  let bufferKind: BlockKind = "p";
  let bufferMarker: string | undefined;

  const flush = () => {
    const text = buffer.join(" ").trim();
    if (text) blocks.push({ kind: bufferKind, marker: bufferMarker, text });
    buffer = [];
    bufferKind = "p";
    bufferMarker = undefined;
  };

  let index = 0;

  // Metadados no topo (front matter), comuns em notas exportadas: nao sao texto.
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, position) => position > 0 && line.trim() === "---");
    if (end > 0) index = end + 1;
  }

  for (; index < lines.length; index += 1) {
    const line = lines[index]!;

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const closer = fence[1]!;
      for (index += 1; index < lines.length; index += 1) {
        const inner = lines[index]!;
        if (inner.trimStart().startsWith(closer)) break;
        if (inner.trim()) blocks.push({ kind: "code", text: inner.trim() });
      }
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    // Setext: a linha de "=" ou "-" transforma o paragrafo de cima em titulo.
    if (bufferKind === "p" && buffer.length > 0 && (SETEXT_1.test(line) || SETEXT_2.test(line))) {
      bufferKind = SETEXT_1.test(line) ? "h1" : "h2";
      flush();
      continue;
    }

    if (RULE.test(line)) {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: headingKind(heading[1]!.length), text: heading[2]! });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      if (bufferKind !== "quote") flush();
      bufferKind = "quote";
      // Linha vazia dentro da citacao separa paragrafos da citacao.
      if (!quote[1]!.trim()) flush();
      else buffer.push(quote[1]!);
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flush();
      bufferKind = "li";
      buffer.push(bullet[1]!);
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered) {
      flush();
      bufferKind = "oli";
      bufferMarker = `${ordered[1]}.`;
      buffer.push(ordered[2]!);
      continue;
    }

    if (TABLE_ROW.test(line) || (TABLE_RULE.test(line) && line.includes("|"))) {
      flush();
      if (TABLE_RULE.test(line)) continue;
      const cells = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean);
      if (cells.length > 0) blocks.push({ kind: "p", text: cells.join(" · ") });
      continue;
    }

    // Linha comum: continua o bloco aberto (paragrafo, item de lista ou
    // citacao sem ">", a "continuacao preguicosa" do Markdown).
    buffer.push(line.trim());
  }

  flush();
  return blocks;
}

/* --- formatacao inline ----------------------------------------------------- */

interface Piece {
  text: string;
  style: number;
}

/**
 * Tira as marcas inline e devolve os trechos de texto com o estilo de cada um.
 *
 * Delimitadores (`*`, `_`, `~~`) so abrem quando o fechamento existe; sem par,
 * ficam como texto. `_` dentro de palavra (snake_case) nunca e marca.
 */
function parseInline(text: string, base: number): Piece[] {
  const tokens: ({ kind: "text"; value: string; style: number } | Delimiter)[] = [];
  let plain = "";

  const pushText = (value: string, style = 0) => {
    if (!value) return;
    if (style === 0) {
      plain += value;
      return;
    }
    flushPlain();
    tokens.push({ kind: "text", value, style });
  };
  const flushPlain = () => {
    if (plain) tokens.push({ kind: "text", value: plain, style: 0 });
    plain = "";
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i]!;

    if (char === "\\" && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!~<>|]/.test(text[i + 1]!)) {
      pushText(text[i + 1]!);
      i += 2;
      continue;
    }

    if (char === "`") {
      const run = /^`+/.exec(text.slice(i))![0];
      const close = text.indexOf(run, i + run.length);
      if (close > 0) {
        pushText(text.slice(i + run.length, close).trim(), STYLE.code);
        i = close + run.length;
        continue;
      }
      pushText(run);
      i += run.length;
      continue;
    }

    // Imagem: fica o texto alternativo, que e o que se le no lugar dela.
    if (char === "!" && text[i + 1] === "[") {
      const link = readLink(text, i + 1);
      if (link) {
        pushText(link.label);
        i = link.end;
        continue;
      }
    }

    if (char === "[") {
      const link = readLink(text, i);
      if (link) {
        flushPlain();
        for (const piece of parseInline(link.label, 0)) {
          tokens.push({ kind: "text", value: piece.text, style: piece.style | STYLE.link });
        }
        i = link.end;
        continue;
      }
    }

    // Link automatico <https://...> e tags HTML: fica o endereco, some a tag.
    if (char === "<") {
      const auto = /^<(https?:\/\/[^>\s]+)>/.exec(text.slice(i));
      if (auto) {
        flushPlain();
        tokens.push({ kind: "text", value: auto[1]!, style: STYLE.link });
        i += auto[0].length;
        continue;
      }
      const tag = /^<\/?[a-zA-Z][^>]*>/.exec(text.slice(i));
      if (tag) {
        pushText(" ");
        i += tag[0].length;
        continue;
      }
    }

    if (char === "*" || char === "_" || (char === "~" && text[i + 1] === "~")) {
      const run = char === "~" ? "~~" : /^(\*+|_+)/.exec(text.slice(i))![0];
      const before = text[i - 1] ?? " ";
      const after = text[i + run.length] ?? " ";
      const canOpen = !/\s/.test(after);
      const canClose = !/\s/.test(before);
      const intraword = char === "_" && /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after);

      if (!intraword && (canOpen || canClose)) {
        flushPlain();
        tokens.push({ kind: "delim", char, length: run.length, canOpen, canClose, used: false });
        i += run.length;
        continue;
      }
      pushText(run);
      i += run.length;
      continue;
    }

    pushText(char);
    i += 1;
  }
  flushPlain();

  return resolveDelimiters(tokens, base);
}

interface Delimiter {
  kind: "delim";
  char: string;
  length: number;
  canOpen: boolean;
  canClose: boolean;
  used: boolean;
}

function readLink(text: string, open: number): { label: string; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "[") depth += 1;
    else if (text[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return null;

  const label = text.slice(open + 1, close);
  const rest = text.slice(close + 1);
  const inline = /^\((?:[^()\s]|\([^()]*\))*(?:\s+"[^"]*")?\)/.exec(rest);
  if (inline) return { label, end: close + 1 + inline[0].length };
  const reference = /^\[[^\]]*\]/.exec(rest);
  if (reference) return { label, end: close + 1 + reference[0].length };
  return null;
}

/** Casa abertura e fechamento; o que sobra sem par vira texto. */
function resolveDelimiters(
  tokens: ({ kind: "text"; value: string; style: number } | Delimiter)[],
  base: number
): Piece[] {
  // Para cada delimitador que fecha, procura o ultimo que abre com a mesma
  // marca e o mesmo tamanho ainda sem par.
  const pairs = new Map<number, number>();
  for (let close = 0; close < tokens.length; close += 1) {
    const token = tokens[close]!;
    if (token.kind !== "delim" || !token.canClose) continue;
    for (let open = close - 1; open >= 0; open -= 1) {
      const candidate = tokens[open]!;
      if (
        candidate.kind === "delim" &&
        !candidate.used &&
        candidate.canOpen &&
        candidate.char === token.char &&
        candidate.length === token.length &&
        !pairs.has(open)
      ) {
        candidate.used = true;
        token.used = true;
        pairs.set(open, close);
        break;
      }
    }
  }

  const styleOf = (delimiter: Delimiter): number => {
    if (delimiter.char === "~") return STYLE.strike;
    if (delimiter.length >= 3) return STYLE.bold | STYLE.italic;
    return delimiter.length === 2 ? STYLE.bold : STYLE.italic;
  };

  const pieces: Piece[] = [];
  const active: number[] = [];
  const closers = new Map<number, number>();
  for (const [open, close] of pairs) closers.set(close, open);

  tokens.forEach((token, position) => {
    if (token.kind === "text") {
      const style = active.reduce((sum, value) => sum | value, base | token.style);
      pieces.push({ text: token.value, style });
      return;
    }
    if (pairs.has(position)) {
      active.push(styleOf(token));
      return;
    }
    if (closers.has(position)) {
      const style = styleOf(tokens[closers.get(position)!] as Delimiter);
      const at = active.lastIndexOf(style);
      if (at >= 0) active.splice(at, 1);
      return;
    }
    // Sem par: e texto.
    const style = active.reduce((sum, value) => sum | value, base);
    pieces.push({ text: token.char.repeat(token.length), style });
  });

  return pieces;
}

/**
 * Palavras e estilos a partir dos trechos. O estilo da palavra e o do primeiro
 * caractere que nao e espaco: "**negrito**parcial" conta como negrito.
 */
function wordsOf(pieces: Piece[]): { words: string[]; styles: number[] } {
  const words: string[] = [];
  const styles: number[] = [];
  let current = "";
  let currentStyle = 0;

  for (const piece of pieces) {
    for (const char of piece.text) {
      if (/\s/.test(char)) {
        if (current) {
          words.push(current);
          styles.push(currentStyle);
        }
        current = "";
        continue;
      }
      if (!current) currentStyle = piece.style;
      current += char;
    }
  }
  if (current) {
    words.push(current);
    styles.push(currentStyle);
  }

  return { words, styles };
}

/* --- documento ------------------------------------------------------------- */

export function parseMarkdown(source: string): MarkdownBlock[] {
  return splitBlocks(source).flatMap((block) => {
    const base =
      block.kind === "code"
        ? STYLE.code
        : block.kind === "h1" || block.kind === "h2" || block.kind === "h3"
          ? STYLE.heading
          : 0;
    const { words, styles } =
      block.kind === "code"
        ? {
            words: block.text.split(/\s+/).filter(Boolean),
            styles: block.text.split(/\s+/).filter(Boolean).map(() => STYLE.code),
          }
        : wordsOf(parseInline(block.text, base));

    return words.length > 0
      ? [{ kind: block.kind, ...(block.marker ? { marker: block.marker } : {}), words, styles }]
      : [];
  });
}

/** Primeiro titulo do documento, para sugerir o titulo do texto importado. */
export function markdownTitle(source: string): string | null {
  const heading = parseMarkdown(source).find((block) => block.kind !== "p" && block.kind.startsWith("h"));
  return heading ? heading.words.join(" ").slice(0, 200) : null;
}

/**
 * O texto colado parece Markdown?
 *
 * Pede dois sinais diferentes, ou um titulo: um asterisco solto ou um hifen
 * de dialogo nao bastam para mudar como o texto e lido.
 */
export function looksLikeMarkdown(source: string): boolean {
  const lines = source.split(/\r?\n/);
  const signals = new Set<string>();

  for (const line of lines) {
    if (HEADING.test(line)) signals.add("titulo");
    else if (QUOTE.test(line)) signals.add("citacao");
    else if (/^\s*[-*+]\s+\S/.test(line)) signals.add("lista");
    else if (ORDERED.test(line)) signals.add("numerada");
    else if (FENCE.test(line)) signals.add("codigo");
    else if (TABLE_ROW.test(line)) signals.add("tabela");
    if (/\*\*[^*\s][^*]*\*\*|__[^_\s][^_]*__/.test(line)) signals.add("negrito");
    if (/\[[^\]]+\]\([^)\s]+\)/.test(line)) signals.add("link");
    if (/`[^`\s][^`]*`/.test(line)) signals.add("codigo-inline");
  }

  return signals.has("titulo") || signals.size >= 2;
}
