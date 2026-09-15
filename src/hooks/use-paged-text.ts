"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Teto de palavras testadas por pagina na busca binaria. */
const MAX_WORDS_PER_PAGE = 800;

/**
 * Quebra o texto em paginas que cabem exatamente na altura disponivel.
 *
 * A medicao usa uma "regua": um elemento oculto com a mesma largura e
 * tipografia da area de leitura, preenchido por manipulacao direta do DOM e
 * consultado por busca binaria. Evita renderizar uma <span> por palavra so
 * para medir - um artigo de cinco mil palavras viraria cinco mil elementos
 * permanentes na arvore.
 *
 * Cada pagina comeca no inicio de uma linha, entao o que foi medido e
 * exatamente o que aparece na tela.
 */
export function usePagedText(words: string[]) {
  const frameRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<number[]>([0]);
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    const frame = frameRef.current;
    const ruler = rulerRef.current;
    if (!frame || !ruler) return;

    const height = frame.clientHeight;
    if (height <= 0) return;

    if (words.length === 0) {
      setPages([0]);
      setReady(true);
      return;
    }

    setPages(computePageStarts(ruler, words, height));
    setReady(true);
  }, [words]);

  useEffect(() => {
    const frame = frameRef.current;
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
  }, [measure]);

  return { frameRef, rulerRef, pages, ready };
}

function computePageStarts(ruler: HTMLElement, words: string[], height: number): number[] {
  const starts = [0];
  let start = 0;

  while (start < words.length) {
    const fitting = wordsThatFit(ruler, words, start, height);
    const next = start + fitting;
    if (next >= words.length) break;
    starts.push(next);
    start = next;
  }

  ruler.textContent = "";
  return starts;
}

/** Maior quantidade de palavras a partir de `start` que cabe em `height`. */
function wordsThatFit(ruler: HTMLElement, words: string[], start: number, height: number): number {
  const remaining = words.length - start;
  let low = 1;
  let high = Math.min(remaining, MAX_WORDS_PER_PAGE);
  let best = 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    ruler.textContent = words.slice(start, start + middle).join(" ");

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
