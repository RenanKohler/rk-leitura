"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isCompound, sliceParagraphs, splitEmphasis, type Paragraph } from "@/lib/reading";
import { styleClass } from "@/lib/markdown";

/** Teto de palavras testadas por pagina na busca binaria. */
const MAX_WORDS_PER_PAGE = 800;

/**
 * Quebra o texto em paginas que cabem exatamente na altura disponivel.
 *
 * A medicao usa uma "regua": um elemento oculto com a mesma largura, tipografia
 * e espacamento entre paragrafos da area de leitura, preenchido por
 * manipulacao direta do DOM e consultado por busca binaria. Evita renderizar
 * uma <span> por palavra so para medir - um artigo de cinco mil palavras
 * viraria cinco mil elementos permanentes na arvore.
 *
 * A regua monta os mesmos paragrafos da pagina visivel: medir um bloco corrido
 * daria uma altura menor que a real, porque o espaco entre paragrafos conta.
 *
 * Cada pagina comeca no inicio de uma linha, entao o que foi medido e
 * exatamente o que aparece na tela.
 */
export function usePagedText(
  paragraphs: Paragraph[],
  totalWords: number,
  emphasis = false,
  /** Tipografia (tamanho, fonte, entrelinha): muda a quebra sem mudar o quadro. */
  layoutKey = ""
) {
  // Ref de callback em vez de objeto: o modo Paginas so monta depois que as
  // preferencias chegam do servidor, entao ao abrir o leitor direto pela URL o
  // efeito rodava com a referencia ainda vazia e nunca voltava a rodar - nenhuma
  // pagina era medida. Guardar o no em estado faz o efeito reagir a montagem.
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<number[]>([0]);
  const [ready, setReady] = useState(false);
  // Medidas da ultima paginacao. O ResizeObserver dispara por qualquer
  // mudanca de caixa - inclusive as que nao mudam o tamanho -, e paginar o
  // texto inteiro de novo custa segundos em textos longos.
  const measuredRef = useRef<{ key: string } | null>(null);

  const measure = useCallback(() => {
    const ruler = rulerRef.current;
    if (!frame || !ruler) return;

    const height = frame.clientHeight;
    if (height <= 0) return;

    const key = `${frame.clientWidth}x${height}:${fontsKey()}:${layoutKey}`;
    if (measuredRef.current?.key === key) return;
    measuredRef.current = { key };

    if (totalWords === 0) {
      setPages([0]);
      setReady(true);
      return;
    }

    setPages(computePageStarts(ruler, paragraphs, totalWords, height, emphasis));
    setReady(true);
  }, [frame, paragraphs, totalWords, emphasis, layoutKey]);

  // Texto, enfase ou tipografia novos invalidam a medida guardada, mesmo com
  // o quadro do mesmo tamanho.
  useEffect(() => {
    measuredRef.current = null;
  }, [paragraphs, totalWords, emphasis, layoutKey]);

  useEffect(() => {
    if (!frame) return;

    // O ResizeObserver dispara na montagem e a cada mudanca de tamanho
    // (rotacao da tela, teclado abrindo). Medir dentro do callback mantem a
    // escrita de estado fora do corpo do efeito.
    const observer = new ResizeObserver(measure);
    observer.observe(frame);

    // Fontes web chegam depois da primeira medicao e mudam a quebra de linha.
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure();
    });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [frame, measure]);

  return { frameRef: setFrame, rulerRef, pages, ready };
}

function computePageStarts(
  ruler: HTMLElement,
  paragraphs: Paragraph[],
  totalWords: number,
  height: number,
  emphasis: boolean
): number[] {
  const starts = [0];
  let start = 0;

  while (start < totalWords) {
    const fitting = wordsThatFit(ruler, paragraphs, totalWords, start, height, emphasis);
    const next = withoutOrphanHeading(paragraphs, start, start + fitting);
    if (next >= totalWords) break;
    starts.push(next);
    start = next;
  }

  ruler.replaceChildren();
  return starts;
}

/**
 * Fim de pagina que nao deixa um titulo sozinho no pe: o titulo desce para a
 * pagina seguinte junto com o bloco que ele abre. So quando sobra conteudo
 * antes dele - senao a pagina ficaria vazia.
 */
function withoutOrphanHeading(paragraphs: Paragraph[], start: number, end: number): number {
  const slice = sliceParagraphs(paragraphs, start, end);
  const last = slice[slice.length - 1];
  if (!last || slice.length < 2) return end;
  const isHeading = last.kind === "h1" || last.kind === "h2" || last.kind === "h3";
  const complete = !last.continued && last.start + last.words.length === end;
  return isHeading && complete ? last.start : end;
}

/**
 * Chave das fontes carregadas: a fonte web que chega depois muda a quebra de
 * linha e precisa invalidar a medida mesmo sem mudar o tamanho do quadro.
 */
function fontsKey(): string {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts) return "";
  let loaded = 0;
  fonts.forEach((face) => {
    if (face.status === "loaded") loaded += 1;
  });
  return String(loaded);
}

/** Maior quantidade de palavras a partir de `start` que cabe em `height`. */
function wordsThatFit(
  ruler: HTMLElement,
  paragraphs: Paragraph[],
  totalWords: number,
  start: number,
  height: number,
  emphasis: boolean
): number {
  const remaining = totalWords - start;
  let low = 1;
  let high = Math.min(remaining, MAX_WORDS_PER_PAGE);
  let best = 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    fillRuler(ruler, paragraphs, start, middle, emphasis);

    if (ruler.scrollHeight <= height) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  // Garante avanco mesmo quando uma unica palavra nao cabe (fonte enorme).
  return Math.max(1, best);
}

function fillRuler(
  ruler: HTMLElement,
  paragraphs: Paragraph[],
  start: number,
  count: number,
  emphasis: boolean
) {
  const nodes = sliceParagraphs(paragraphs, start, start + count).map((paragraph) => {
    const element = document.createElement("p");
    // Titulo e item de lista tem corpo e recuo proprios: a regua precisa do
    // mesmo tipo de bloco da pagina para medir a mesma altura.
    if (paragraph.kind && paragraph.kind !== "p") {
      element.dataset.kind = paragraph.kind;
      if (paragraph.marker) element.dataset.marker = paragraph.marker;
    }
    // O recuo de primeira linha muda onde as linhas quebram: o trecho que
    // continua da pagina anterior nao o recebe, na pagina e aqui.
    if (paragraph.continued) element.dataset.cont = "";

    const styled = paragraph.styles?.some((style) => styleClass(style) !== "") ?? false;
    if (!emphasis && !styled && !paragraph.words.some(isCompound)) {
      // textContent, nunca innerHTML: o conteudo vem de uma pagina externa.
      element.textContent = paragraph.words.join(" ");
      return element;
    }

    // Com enfase ou estilo Markdown, a regua monta a mesma arvore da pagina
    // visivel: o negrito e mais largo que o texto normal, e medir texto
    // corrido daria uma pagina que nao cabe na tela. As duas saem de
    // `splitEmphasis` e `styleClass`.
    for (const [index, word] of paragraph.words.entries()) {
      if (index > 0) element.append(document.createTextNode(" "));
      const classes = styleClass(paragraph.styles?.[index] ?? 0);
      let target: HTMLElement = element;
      if (classes) {
        target = document.createElement("span");
        target.className = classes;
        element.append(target);
      }
      // Mesmo involucro da pagina: palavra com hifen nao quebra na linha.
      if (isCompound(word)) {
        const joined = document.createElement("span");
        joined.className = "nobreak";
        target.append(joined);
        target = joined;
      }
      for (const part of splitEmphasis(word, emphasis)) {
        if (part.bold) {
          const strong = document.createElement("b");
          strong.textContent = part.text;
          target.append(strong);
        } else {
          target.append(document.createTextNode(part.text));
        }
      }
    }

    return element;
  });

  ruler.replaceChildren(...nodes);
}

/** Indice da pagina que contem a palavra `wordIndex`. */
export function pageOfWord(pages: number[], wordIndex: number): number {
  let low = 0;
  let high = pages.length - 1;
  let found = 0;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (pages[middle]! <= wordIndex) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found;
}
