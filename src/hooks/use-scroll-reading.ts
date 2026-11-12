"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Paragraph } from "@/lib/reading";
import {
  paragraphIndexOf,
  SCROLL_SETTLE_MS,
  wordInView,
  wordSpanInText,
} from "@/lib/scroll-reading";
import { wordIndexFromPoint } from "@/hooks/use-word-selection";

/**
 * Liga a rolagem da coluna de texto a posicao de leitura, nos dois sentidos.
 *
 * - O leitor arrasta o texto: quando a rolagem para, a primeira palavra a
 *   vista vira a posicao (`onSettle`).
 * - A posicao muda por outro caminho (pausa do Word Runner, guia, narracao,
 *   busca, botoes de pagina, abertura do texto): se a palavra nao esta a
 *   vista, a coluna rola ate ela. Estando a vista, nada se mexe - tocar numa
 *   palavra nao pode fazer o texto pular.
 *
 * A rolagem feita aqui nao volta como posicao: a altura em que ela deixou a
 * coluna fica guardada, e o evento que chega com essa mesma altura e ignorado.
 */
export function useScrollReading({
  enabled,
  active,
  frameRef,
  proseRef,
  paragraphs,
  index,
  layoutKey,
  onSettle,
}: {
  /** Modo rolagem ligado. */
  enabled: boolean;
  /** Coluna na tela (nao coberta pelo Word Runner). */
  active: boolean;
  frameRef: React.RefObject<HTMLDivElement | null>;
  /** Elemento cujos filhos sao os paragrafos, na ordem de `paragraphs`. */
  proseRef: React.RefObject<HTMLDivElement | null>;
  paragraphs: Paragraph[];
  /** Posicao de leitura. */
  index: number;
  /** Tipografia: quando muda, o texto quebra de outro jeito. */
  layoutKey: string;
  /** A rolagem do leitor parou com esta palavra no topo. */
  onSettle: (position: number) => void;
}) {
  /** Altura da rolagem depois do ultimo ajuste feito aqui. */
  const placedTopRef = useRef<number | null>(null);
  /** Topo da coluna na tela, para segurar o texto quando ela muda de tamanho. */
  const frameTopRef = useRef<number | null>(null);
  // Fontes carregadas e coluna redimensionada mudam a quebra: confere de novo.
  const [layoutTick, setLayoutTick] = useState(0);

  const onSettleRef = useRef(onSettle);
  useEffect(() => {
    onSettleRef.current = onSettle;
  }, [onSettle]);

  // A posicao que mudou por fora da rolagem entra na tela.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const prose = proseRef.current;
    if (!enabled || !active || !frame || !prose) return;

    const word = wordBox(prose, paragraphs, index);
    if (!word) return;
    const box = frame.getBoundingClientRect();
    if (wordInView(word, box)) return;

    // Uma linha de folga em cima: a palavra nao fica colada na borda.
    frame.scrollTop += word.top - box.top - lineHeightOf(prose);
    placedTopRef.current = frame.scrollTop;
  }, [enabled, active, frameRef, proseRef, paragraphs, index, layoutKey, layoutTick]);

  // A coluna cresce e encolhe quando os controles saem e voltam (US-213): o
  // texto fica onde estava na tela, em vez de subir ou descer junto.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const top = frame.getBoundingClientRect().top;
    const before = frameTopRef.current;
    frameTopRef.current = top;
    if (!enabled || !active || before === null || Math.abs(top - before) < 1) return;
    frame.scrollTop += top - before;
    placedTopRef.current = frame.scrollTop;
  });

  useEffect(() => {
    const frame = frameRef.current;
    if (!enabled || !frame) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      timer = null;
      const prose = proseRef.current;
      if (!prose) return;
      // Rolagem feita aqui mesmo: nao e o leitor mudando de lugar.
      if (placedTopRef.current !== null && Math.abs(frame.scrollTop - placedTopRef.current) <= 1) {
        return;
      }
      placedTopRef.current = null;
      const position = firstWordInView(frame, prose);
      if (position !== null) onSettleRef.current(position);
    };
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(settle, SCROLL_SETTLE_MS);
    };

    frame.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      frame.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [enabled, frameRef, proseRef]);

  const recheck = useCallback(() => setLayoutTick((tick) => tick + 1), []);
  useEffect(() => {
    const frame = frameRef.current;
    if (!enabled || !frame) return;
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) recheck();
    });
    // So a largura muda a quebra das linhas; a altura muda a cada vez que os
    // controles saem e voltam, sem mexer no texto.
    let width = frame.clientWidth;
    const observer = new ResizeObserver(() => {
      if (frame.clientWidth === width) return;
      width = frame.clientWidth;
      recheck();
    });
    observer.observe(frame);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [enabled, frameRef, recheck]);
}

function lineHeightOf(element: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(element).lineHeight);
  return Number.isFinite(value) && value > 0 ? value : 28;
}

/**
 * Primeira palavra a vista na coluna: a que abre a primeira linha com pelo
 * menos metade da altura dentro dela.
 */
function firstWordInView(frame: HTMLElement, prose: HTMLElement): number | null {
  const top = frame.getBoundingClientRect().top;
  const blocks = prose.children;

  // Primeiro paragrafo que ainda tem alguma coisa abaixo do topo.
  let low = 0;
  let high = blocks.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (blocks[middle]!.getBoundingClientRect().bottom > top + 1) {
      found = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  if (found === -1) return null;

  const block = blocks[found] as HTMLElement;
  const first = Number(block.querySelector<HTMLElement>("[data-start]")?.dataset.start);
  if (!Number.isFinite(first)) return null;

  const box = block.getBoundingClientRect();
  // O paragrafo comeca na tela: a leitura esta na primeira palavra dele.
  if (box.top >= top - 1) return first;

  // Cortado pelo topo: a palavra no comeco da linha que esta a vista.
  const line = lineHeightOf(block);
  const y = Math.min(top + line / 2, box.bottom - 1);
  const position = wordIndexFromPoint(box.left + 2, y);
  const end = Number((blocks[found + 1] as HTMLElement | undefined)?.querySelector<HTMLElement>("[data-start]")?.dataset.start);
  // O ponto pode cair fora do texto (recuo, marcador de lista): fica o
  // paragrafo, que e o que se sabe com certeza.
  if (position === null || position < first || (Number.isFinite(end) && position >= end)) {
    return first;
  }
  return position;
}

/** Caixa, na tela, da linha em que a palavra esta. */
function wordBox(
  prose: HTMLElement,
  paragraphs: Paragraph[],
  index: number
): { top: number; bottom: number } | null {
  const at = paragraphIndexOf(paragraphs, index);
  const block = at >= 0 ? (prose.children[at] as HTMLElement | undefined) : undefined;
  if (!block) return null;

  // O pedaco (`data-start`) que contem a palavra: o ultimo que comeca nela ou antes.
  let chunk: HTMLElement | null = null;
  for (const candidate of block.querySelectorAll<HTMLElement>("[data-start]")) {
    if (Number(candidate.dataset.start) > index) break;
    chunk = candidate;
  }
  if (!chunk) return block.getBoundingClientRect();

  const span = wordSpanInText(chunk.textContent ?? "", index - Number(chunk.dataset.start));
  if (!span) return block.getBoundingClientRect();

  const range = document.createRange();
  const walker = document.createTreeWalker(chunk, NodeFilter.SHOW_TEXT);
  let passed = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (span.start < passed + length) {
      const from = span.start - passed;
      range.setStart(node, from);
      range.setEnd(node, Math.min(length, from + 1));
      const box = range.getClientRects()[0] ?? range.getBoundingClientRect();
      return box.height > 0 ? box : block.getBoundingClientRect();
    }
    passed += length;
  }
  return block.getBoundingClientRect();
}
