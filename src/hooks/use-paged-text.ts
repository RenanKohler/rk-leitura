"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sliceParagraphs, type Paragraph } from "@/lib/reading";

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
export function usePagedText(paragraphs: Paragraph[], totalWords: number) {
  // Ref de callback em vez de objeto: o modo Paginas so monta depois que as
  // preferencias chegam do servidor, entao ao abrir o leitor direto pela URL o
  // efeito rodava com a referencia ainda vazia e nunca voltava a rodar - nenhuma
  // pagina era medida. Guardar o no em estado faz o efeito reagir a montagem.
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<number[]>([0]);
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    const ruler = rulerRef.current;
    if (!frame || !ruler) return;

    const height = frame.clientHeight;
    if (height <= 0) return;

    if (totalWords === 0) {
      setPages([0]);
      setReady(true);
      return;
    }

    setPages(computePageStarts(ruler, paragraphs, totalWords, height));
    setReady(true);
  }, [frame, paragraphs, totalWords]);

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
  height: number
): number[] {
  const starts = [0];
  let start = 0;

  while (start < totalWords) {
    const fitting = wordsThatFit(ruler, paragraphs, totalWords, start, height);
    const next = start + fitting;
    if (next >= totalWords) break;
    starts.push(next);
    start = next;
  }

  ruler.replaceChildren();
  return starts;
}

/** Maior quantidade de palavras a partir de `start` que cabe em `height`. */
function wordsThatFit(
  ruler: HTMLElement,
  paragraphs: Paragraph[],
  totalWords: number,
  start: number,
  height: number
): number {
  const remaining = totalWords - start;
  let low = 1;
  let high = Math.min(remaining, MAX_WORDS_PER_PAGE);
  let best = 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    fillRuler(ruler, paragraphs, start, middle);

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

function fillRuler(ruler: HTMLElement, paragraphs: Paragraph[], start: number, count: number) {
  const nodes = sliceParagraphs(paragraphs, start, start + count).map((paragraph) => {
    const element = document.createElement("p");
    // textContent, nunca innerHTML: o conteudo vem de uma pagina externa.
    element.textContent = paragraph.words.join(" ");
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
