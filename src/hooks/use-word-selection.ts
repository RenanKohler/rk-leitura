"use client";

import { useCallback, useEffect, useState } from "react";
import { wordIndexAtEnd, wordIndexAtStart, type Span } from "@/lib/highlights";

/**
 * Converte a selecao de texto da tela em um intervalo de palavras.
 *
 * O elo entre o DOM e os indices e o atributo `data-start`: cada pedaco
 * renderizado declara em que palavra do texto ele comeca, e a contagem dentro
 * do pedaco faz o resto. Assim o modo Paginas continua desenhando texto
 * corrido - uma `<span>` por palavra mudaria o que a regua de paginacao mede.
 */
export function useWordSelection(enabled: boolean): {
  span: Span | null;
  clear: () => void;
} {
  const [span, setSpan] = useState<Span | null>(null);

  const clear = useCallback(() => {
    setSpan(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // `selectionchange` dispara a cada arrasto; ler no fim do gesto evita
    // recalcular dezenas de vezes e mostrar a barra antes de o leitor soltar.
    const onEnd = () => setSpan(spanFromSelection());

    document.addEventListener("pointerup", onEnd);
    document.addEventListener("keyup", onEnd);
    return () => {
      document.removeEventListener("pointerup", onEnd);
      document.removeEventListener("keyup", onEnd);
    };
  }, [enabled]);

  // O corte vem da leitura, nao de um efeito que zera o estado: trocar de modo
  // no meio de uma selecao nao pode deixar a barra de destacar na tela.
  return { span: enabled ? span : null, clear };
}

function spanFromSelection(): Span | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const start = edge(range.startContainer, range.startOffset, "start");
  const end = edge(range.endContainer, range.endOffset, "end");
  if (start === null || end === null || end <= start) return null;

  return { start, end };
}

/**
 * Indice da palavra em um extremo da selecao.
 *
 * O deslocamento e medido dentro do pedaco inteiro, nao do no de texto: um
 * pedaco pode ter sido dividido pelo navegador, e a contagem por no daria a
 * palavra errada.
 */
function edge(node: Node, offset: number, side: "start" | "end"): number | null {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  const holder = element?.closest<HTMLElement>("[data-start]");
  if (!holder) return null;

  const base = Number(holder.dataset.start);
  if (!Number.isFinite(base)) return null;

  const text = holder.textContent ?? "";
  const within = offsetWithin(holder, node, offset);

  return base + (side === "start" ? wordIndexAtStart(text, within) : wordIndexAtEnd(text, within));
}

/** Soma o texto dos nos anteriores ao no do corte, dentro do mesmo pedaco. */
function offsetWithin(holder: HTMLElement, node: Node, offset: number): number {
  if (node === holder) {
    // O corte caiu entre filhos: soma o texto dos filhos antes dele.
    let total = 0;
    for (let i = 0; i < offset && i < holder.childNodes.length; i += 1) {
      total += holder.childNodes[i]?.textContent?.length ?? 0;
    }
    return total;
  }

  const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current = walker.nextNode();

  while (current) {
    if (current === node) return total + offset;
    total += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }

  return total;
}
