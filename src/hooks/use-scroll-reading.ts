"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Paragraph } from "@/lib/reading";
import {
  followScrollTop,
  followStep,
  paragraphIndexOf,
  SCROLL_SETTLE_MS,
  wordInView,
  wordSpanInText,
} from "@/lib/scroll-reading";
import { wordIndexFromPoint } from "@/hooks/use-word-selection";

/** Linha que a rolagem automatica persegue, em px do conteudo da coluna. */
interface FollowLine {
  top: number;
  height: number;
  /** Quanto da linha ja foi lido, de 0 a 1. */
  progress: number;
}

/**
 * Liga a rolagem da coluna de texto a posicao de leitura, nos dois sentidos.
 *
 * - O leitor arrasta o texto: quando a rolagem para, a primeira palavra a
 *   vista vira a posicao (`onSettle`).
 * - A posicao muda por outro caminho (pausa do Word Runner, busca, botoes de
 *   pagina, abertura do texto): se a palavra nao esta a vista, a coluna rola
 *   ate ela. Estando a vista, nada se mexe - tocar numa palavra nao pode
 *   fazer o texto pular.
 * - O guia na pagina ou a narracao correm (`follow`, US-225): a coluna rola
 *   sozinha, sem parar, com a linha da leitura numa altura fixa do quadro. O
 *   dedo manda: enquanto o leitor toca ou arrasta a coluna ela cede, e volta
 *   a linha quando ele solta.
 *
 * A rolagem feita aqui nao volta como posicao: a altura em que ela deixou a
 * coluna fica guardada, e o evento que chega com essa mesma altura e ignorado.
 */
export function useScrollReading({
  enabled,
  active,
  follow,
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
  /**
   * Guia na pagina ou narracao correndo: a coluna acompanha a palavra
   * sozinha, em vez de esperar ela sair da vista para saltar (US-225).
   */
  follow: boolean;
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
  /**
   * Ultima posicao que a coluna ja acompanhou. A avisada por `onSettle` veio
   * da propria rolagem: a coluna ja esta onde o leitor a deixou e nao se mexe
   * por causa dela, nem quando a conta da primeira palavra a vista erra por
   * uma linha. A que a rolagem automatica seguiu tambem conta: ao pausar, a
   * coluna fica onde esta.
   */
  const settledIndexRef = useRef<number | null>(null);
  /**
   * Linha que a rolagem automatica persegue. Medida quando a palavra muda; o
   * laco de animacao so le, sem medir o texto a cada quadro.
   */
  const followLineRef = useRef<FollowLine | null>(null);
  /**
   * Rolagem automatica ligada: o guia ou a narracao mandam na posicao, e a
   * rolagem do leitor e um desvio passageiro, nao um lugar novo.
   */
  const followingRef = useRef(false);
  const layoutSeenRef = useRef<string | null>(null);
  /** Topo da coluna na tela, para segurar o texto quando ela muda de tamanho. */
  const frameTopRef = useRef<number | null>(null);
  /**
   * O leitor esta com o dedo na coluna, ou ela ainda corre com o impulso.
   * Enquanto isso a coluna nao e reposicionada por ter mudado de tamanho:
   * escrever a posicao no meio do gesto briga com o dedo, e no celular o
   * arraste trava ou volta. (A posicao que muda por outro caminho - pausa,
   * busca, retomada - continua valendo: e um pedido, nao um ajuste.)
   */
  const gestureRef = useRef({ touching: false, scrolledAt: Number.NEGATIVE_INFINITY });
  const userScrolling = useCallback(
    () =>
      gestureRef.current.touching ||
      performance.now() - gestureRef.current.scrolledAt < USER_SCROLL_QUIET_MS,
    []
  );
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
    // Tipografia ou largura novas quebram o texto de outro jeito: ai a
    // posicao volta a ser conferida, mesmo tendo vindo da rolagem.
    const layout = `${layoutKey}:${layoutTick}`;
    const reflowed = layoutSeenRef.current !== layout;
    layoutSeenRef.current = layout;

    if (follow) {
      // Com a rolagem automatica nada salta aqui: a linha da palavra vira o
      // alvo, e o laco de animacao leva a coluna ate ela. A posicao fica
      // dada como acompanhada, para a pausa nao reposicionar a coluna - nem
      // quando o leitor a arrastou para longe da linha do guia.
      settledIndexRef.current = index;
      followLineRef.current = lineOf(frame, prose, paragraphs, index);
      return;
    }
    if (!reflowed && index === settledIndexRef.current) return;
    settledIndexRef.current = null;

    const word = wordBox(prose, paragraphs, index);
    if (!word) return;
    const box = frame.getBoundingClientRect();
    if (wordInView(word, box)) return;

    // Uma linha de folga em cima: a palavra nao fica colada na borda.
    frame.scrollTop += word.top - box.top - lineHeightOf(prose);
    placedTopRef.current = frame.scrollTop;
  }, [enabled, active, follow, frameRef, proseRef, paragraphs, index, layoutKey, layoutTick]);

  // Rolagem automatica (US-225). A cada quadro a coluna anda uma fracao do
  // que falta ate a linha da leitura ficar na ancora: como o alvo anda no
  // ritmo das palavras, o resultado e um movimento continuo, sem o salto de
  // quase uma tela que havia quando a palavra saia da vista.
  useEffect(() => {
    const frame = frameRef.current;
    if (!enabled || !active || !follow || !frame) return;
    followingRef.current = true;
    // Movimento reduzido: sem deslize, a coluna da um passo a cada linha.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Altura da rolagem com as casas decimais. A que o navegador devolve vem
    // arredondada para o pixel da tela; somando a ela, um avanco de menos de
    // um pixel por quadro (o ritmo normal de leitura) nunca sairia do lugar.
    let top: number | null = null;
    let last = performance.now();
    let request = 0;
    const step = () => {
      request = requestAnimationFrame(step);
      const now = performance.now();
      const elapsed = Math.min(FOLLOW_FRAME_CAP_MS, now - last);
      last = now;

      const line = followLineRef.current;
      // O dedo manda: enquanto o leitor toca ou a coluna ainda corre com o
      // impulso, nada e escrito. Solta e quieta, ela volta dali.
      if (!line || userScrolling()) {
        top = null;
        return;
      }
      // Outra mao mexeu na coluna (o leitor, a compensacao do quadro): a
      // conta recomeca de onde ela esta, em vez de desfazer o que foi feito.
      const here = frame.scrollTop;
      if (top === null || Math.abs(here - top) > FOLLOW_RESYNC_PX) top = here;

      const height = frame.clientHeight;
      const target = followScrollTop({
        lineTop: line.top,
        lineHeight: line.height,
        progress: reduced ? 0 : line.progress,
        frameHeight: height,
        contentHeight: frame.scrollHeight,
      });
      const next = reduced ? target : followStep(top, target, elapsed, height);
      if (next === top) return;
      top = next;
      frame.scrollTop = next;
      // Um evento de rolagem por quadro: todos saem daqui, e a altura
      // guardada e o que os separa da rolagem do leitor.
      placedTopRef.current = frame.scrollTop;
    };
    request = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(request);
      followingRef.current = false;
    };
  }, [enabled, active, follow, frameRef, userScrolling]);

  // A coluna cresce e encolhe quando os controles saem e voltam (US-213): o
  // texto fica onde estava na tela, em vez de subir ou descer junto. Com a
  // rolagem automatica ligada o ajuste nao se soma a ela: o laco de animacao
  // parte da altura que ficou aqui e desliza so o que faltar ate a ancora,
  // que e uma fracao da altura nova do quadro.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const top = frame.getBoundingClientRect().top;
    const before = frameTopRef.current;
    frameTopRef.current = top;
    if (!enabled || !active || before === null || Math.abs(top - before) < 1) return;
    // No meio de um arraste o texto ja esta em movimento: o salto dos
    // controles se perde nele, e escrever a posicao interromperia o gesto.
    if (userScrolling()) return;
    frame.scrollTop += top - before;
    placedTopRef.current = frame.scrollTop;
  });

  useEffect(() => {
    const frame = frameRef.current;
    if (!enabled || !frame) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    // A coluna esta na altura em que a ultima rolagem feita aqui a deixou.
    const own = () =>
      placedTopRef.current !== null && Math.abs(frame.scrollTop - placedTopRef.current) <= 1;
    const settle = () => {
      timer = null;
      const prose = proseRef.current;
      if (!prose) return;
      // Parada armada antes de a rolagem automatica comecar: o guia e a
      // narracao ja mandam na posicao.
      if (followingRef.current) return;
      // Rolagem feita aqui mesmo: nao e o leitor mudando de lugar.
      if (own()) return;
      placedTopRef.current = null;
      const position = firstWordInView(frame, prose);
      if (position === null) return;
      settledIndexRef.current = position;
      onSettleRef.current(position);
    };
    const gesture = gestureRef.current;
    const onScroll = () => {
      // So a rolagem do leitor conta como gesto e como posicao; a feita aqui
      // nao. A rolagem automatica dispara um evento por quadro, e nenhum deles
      // pode adiar a parada do leitor nem armar outra.
      if (own()) return;
      gesture.scrolledAt = performance.now();
      // Arrastar com o guia ou a narracao correndo so afasta a coluna por um
      // momento: nao ha parada a avisar, nem depois que a leitura pausar.
      if (followingRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(settle, SCROLL_SETTLE_MS);
    };
    const onTouchEnd = () => {
      gesture.touching = false;
    };
    /**
     * O fim do toque vai para o elemento onde ele comecou. Se a palavra sob o
     * dedo for redesenhada no meio do toque (o guia passou por ela), esse
     * elemento sai do documento e o fim nao chega ate a coluna: sem ouvir no
     * proprio alvo, `touching` ficaria preso e a rolagem automatica parava.
     */
    const onTouchStart = (event: TouchEvent) => {
      gesture.touching = true;
      const target = event.target;
      if (!(target instanceof EventTarget) || target === frame) return;
      const done = () => {
        onTouchEnd();
        target.removeEventListener("touchend", done);
        target.removeEventListener("touchcancel", done);
      };
      target.addEventListener("touchend", done, { passive: true });
      target.addEventListener("touchcancel", done, { passive: true });
    };

    frame.addEventListener("scroll", onScroll, { passive: true });
    frame.addEventListener("touchstart", onTouchStart, { passive: true });
    frame.addEventListener("touchend", onTouchEnd, { passive: true });
    frame.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      frame.removeEventListener("scroll", onScroll);
      frame.removeEventListener("touchstart", onTouchStart);
      frame.removeEventListener("touchend", onTouchEnd);
      frame.removeEventListener("touchcancel", onTouchEnd);
      gesture.touching = false;
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

/** Tempo sem rolagem do leitor ate a coluna ser dada como solta. */
const USER_SCROLL_QUIET_MS = 250;

/**
 * Teto do tempo contado entre dois quadros da rolagem automatica: um quadro
 * atrasado (aba que voltou, tela travada por um instante) nao vira salto.
 */
const FOLLOW_FRAME_CAP_MS = 50;

/**
 * Diferenca, em px, entre a altura que a rolagem automatica escreveu e a que
 * a coluna tem, acima da qual outra mao mexeu nela. Abaixo disso e so o
 * arredondamento do navegador para o pixel da tela.
 */
const FOLLOW_RESYNC_PX = 2;

function lineHeightOf(element: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(element).lineHeight);
  return Number.isFinite(value) && value > 0 ? value : 28;
}

/**
 * Linha da palavra para a rolagem automatica: o topo dela no conteudo da
 * coluna (nao na tela, que muda a cada quadro) e o quanto da largura a
 * palavra ja atravessou.
 */
function lineOf(
  frame: HTMLElement,
  prose: HTMLElement,
  paragraphs: Paragraph[],
  index: number
): FollowLine | null {
  const word = wordBox(prose, paragraphs, index);
  if (!word) return null;
  const box = frame.getBoundingClientRect();
  const column = prose.getBoundingClientRect();
  return {
    top: word.top - box.top + frame.scrollTop,
    height: lineHeightOf(prose),
    progress: column.width > 0 ? (word.left - column.left) / column.width : 0,
  };
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

/** Caixa, na tela, da linha em que a palavra esta, a partir do comeco da palavra. */
function wordBox(
  prose: HTMLElement,
  paragraphs: Paragraph[],
  index: number
): { top: number; bottom: number; left: number } | null {
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
