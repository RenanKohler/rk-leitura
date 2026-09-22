"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiSend } from "@/lib/client";
import { useSettings, useToast } from "@/components/providers";
import { Button, Card, EmptyState, LinkButton, Sheet } from "@/components/ui";
import { BackIcon, DragIcon, QueueIcon, TrashIcon } from "@/components/icons";
import { estimatedMinutes, formatNumber } from "@/lib/reading";
import { STALE_QUEUE_DAYS } from "@/lib/pacing";
import type { TextSummary } from "@/lib/types";

/**
 * A fila de leitura.
 *
 * Arrastar e o gesto pedido, e ele funciona no toque porque a alca usa eventos
 * de ponteiro com `touch-action: none` - sem isso o dedo rola a pagina em vez
 * de mover o item. Os botoes de subir e descer ficam ao lado: teclado e
 * leitor de tela nao tem como arrastar.
 */
/** Quanto tempo o "Desfazer" da falencia fica disponivel (US-82). */
const UNDO_MS = 10_000;

export function QueueClient({ initial, stale = [] }: { initial: TextSummary[]; stale?: string[] }) {
  const { settings } = useSettings();
  const notify = useToast();
  const [items, setItems] = useState(initial);

  // Falencia da fila (US-82): os parados ha mais de 30 dias, revisados e
  // largados de uma vez, com um "Desfazer" por alguns segundos.
  const [staleIds, setStaleIds] = useState(stale);
  const staleItems = items.filter((item) => staleIds.includes(item.id));
  const [reviewing, setReviewing] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [bankrupting, setBankrupting] = useState(false);
  const [undo, setUndo] = useState<{
    restore: { id: string; queuePosition: number }[];
    before: TextSummary[];
  } | null>(null);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const openReview = () => {
    setChosen(staleItems.map((item) => item.id));
    setReviewing(true);
  };

  const bankrupt = async () => {
    if (chosen.length === 0 || bankrupting) return;
    setBankrupting(true);
    const before = orderRef.current;
    try {
      const result = await apiSend<{
        abandoned: number;
        restore: { id: string; queuePosition: number }[];
      }>("/api/fila/largar", "POST", { ids: chosen });
      apply(before.filter((item) => !chosen.includes(item.id)));
      setStaleIds((current) => current.filter((id) => !chosen.includes(id)));
      setUndo({ restore: result.restore, before });
      setReviewing(false);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Nao consegui largar.", "error");
    } finally {
      setBankrupting(false);
    }
  };

  const undoBankrupt = async () => {
    if (!undo) return;
    const snapshot = undo;
    setUndo(null);
    try {
      await apiSend("/api/fila/retomar", "POST", { restore: snapshot.restore });
      apply(snapshot.before);
      setStaleIds(stale);
      notify("Textos de volta a fila.", "success");
    } catch {
      notify("Nao consegui desfazer.", "error");
    }
  };
  const [dragging, setDragging] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // A ordem viva do arrasto.
  //
  // O gesto emite dezenas de eventos entre dois renders, e cada um precisa
  // saber onde o item esta agora. Lendo o estado, todos leriam a posicao de
  // antes do gesto e o item voltaria ao lugar a cada movimento.
  const orderRef = useRef(items);

  const apply = (next: TextSummary[]) => {
    orderRef.current = next;
    setItems(next);
  };

  const persist = async (next: TextSummary[]) => {
    const before = orderRef.current;
    // Otimista: o arrasto ja moveu o item na tela, e desfazer depois da
    // resposta seria um solavanco a cada gesto.
    apply(next);
    try {
      await apiSend("/api/fila", "PUT", { ids: next.map((item) => item.id) });
    } catch {
      apply(before);
      notify("Nao consegui salvar a ordem.", "error");
    }
  };

  const move = (from: number, to: number) => {
    const next = reorder(orderRef.current, from, to);
    if (next) void persist(next);
  };

  const remove = async (id: string) => {
    const before = orderRef.current;
    apply(before.filter((item) => item.id !== id));
    try {
      await apiSend(`/api/fila?texto=${id}`, "DELETE");
    } catch {
      apply(before);
      notify("Nao consegui tirar da fila.", "error");
    }
  };

  /** Indice sob o ponteiro, pela posicao vertical das linhas. */
  const indexAt = (clientY: number): number => {
    const rows = listRef.current?.querySelectorAll("li") ?? [];
    for (let index = 0; index < rows.length; index += 1) {
      const rect = rows[index]!.getBoundingClientRect();
      if (clientY < rect.bottom) return index;
    }
    return rows.length - 1;
  };

  const startDrag = (id: string) => (event: React.PointerEvent) => {
    event.preventDefault();
    setDragging(id);

    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);

    const onMove = (moved: PointerEvent) => {
      const from = orderRef.current.findIndex((item) => item.id === id);
      const next = reorder(orderRef.current, from, indexAt(moved.clientY));
      if (next) apply(next);
    };

    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setDragging(null);
      // Grava uma vez, no fim do gesto: durante ele a ordem muda a cada pixel.
      void apiSend("/api/fila", "PUT", { ids: orderRef.current.map((item) => item.id) }).catch(
        () => notify("Nao consegui salvar a ordem.", "error")
      );
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-2 pt-2">
        <Link
          href="/textos"
          aria-label="Voltar para a biblioteca"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        >
          <BackIcon className="size-5" />
        </Link>
        <div className="flex-1 pt-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Fila de leitura</h1>
          <p className="mt-1 text-sm text-muted">
            {items.length === 0
              ? "Vazia"
              : `${items.length} ${items.length === 1 ? "texto" : "textos"} na ordem que voce definiu`}
          </p>
        </div>
      </header>

      {undo ? (
        <Card className="flex items-center gap-3 p-3">
          <p className="flex-1 text-sm" role="status">
            {undo.restore.length === 1
              ? "1 texto largado."
              : `${undo.restore.length} textos largados.`}
          </p>
          <Button size="sm" variant="secondary" onClick={() => void undoBankrupt()}>
            Desfazer
          </Button>
        </Card>
      ) : null}

      {staleItems.length > 0 ? (
        <Card className="space-y-3 p-4">
          <p className="text-sm">
            {staleItems.length === 1
              ? `1 texto parado ha mais de ${STALE_QUEUE_DAYS} dias.`
              : `${staleItems.length} textos parados ha mais de ${STALE_QUEUE_DAYS} dias.`}
          </p>
          <Button variant="secondary" full onClick={openReview}>
            Revisar e largar
          </Button>
        </Card>
      ) : null}

      <Sheet
        open={reviewing}
        onClose={() => setReviewing(false)}
        title="Largar textos parados"
        footer={
          <Button
            variant="danger"
            size="lg"
            full
            loading={bankrupting}
            disabled={chosen.length === 0}
            onClick={() => void bankrupt()}
          >
            {chosen.length === 1 ? "Largar 1 texto" : `Largar ${chosen.length} textos`}
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Saem da fila e da biblioteca e ficam no filtro Largados. Desmarque o que ainda quer ler.
          </p>
          <ul className="space-y-1">
            {staleItems.map((item) => (
              <li key={item.id}>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--color-accent)]"
                    checked={chosen.includes(item.id)}
                    onChange={(event) =>
                      setChosen((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id)
                      )
                    }
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </Sheet>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<QueueIcon className="size-7" />}
            title="Fila vazia"
            description="Use o botao de fila no cartao de um texto para coloca-lo aqui. Ao terminar uma leitura, o app oferece o proximo da fila."
            action={<LinkButton href="/textos">Ir para a biblioteca</LinkButton>}
          />
        </Card>
      ) : (
        <ul ref={listRef} className="space-y-2">
          {items.map((item, index) => (
            <li key={item.id}>
              <Card
                className={`flex items-center gap-1 p-3 transition-shadow ${
                  dragging === item.id ? "shadow-float" : ""
                }`}
              >
                <button
                  type="button"
                  aria-label={`Arrastar ${item.title}`}
                  onPointerDown={startDrag(item.id)}
                  style={{ touchAction: "none" }}
                  className="flex size-11 shrink-0 cursor-grab items-center justify-center rounded-full text-faint active:cursor-grabbing"
                >
                  <DragIcon className="size-5" />
                </button>

                <Link href={`/leitor/${item.id}`} className="min-w-0 flex-1 py-1">
                  <p className="truncate font-medium leading-snug">{item.title}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {`${formatNumber(item.wordCount)} palavras · ~${estimatedMinutes(item.wordCount, settings.baseWpm)} min`}
                  </p>
                </Link>

                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    aria-label={`Subir ${item.title}`}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                    className="flex h-6 w-9 items-center justify-center rounded-lg text-muted disabled:opacity-30"
                  >
                    <ChevronUp />
                  </button>
                  <button
                    type="button"
                    aria-label={`Descer ${item.title}`}
                    disabled={index === items.length - 1}
                    onClick={() => move(index, index + 1)}
                    className="flex h-6 w-9 items-center justify-center rounded-lg text-muted disabled:opacity-30"
                  >
                    <ChevronUp className="rotate-180" />
                  </button>
                </div>

                <button
                  type="button"
                  aria-label={`Tirar ${item.title} da fila`}
                  onClick={() => void remove(item.id)}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"
                >
                  <TrashIcon className="size-5" />
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {items.length > 1 ? (
        <p className="text-center text-sm text-faint">
          Arraste pela alca, ou use as setas.
        </p>
      ) : null}

      {items.length > 0 ? (
        <Link href={`/leitor/${items[0]!.id}`} className="block">
          <Button size="lg" full>
            Comecar pelo primeiro
          </Button>
        </Link>
      ) : null}
    </div>
  );
}

/** Lista com o item movido de `from` para `to`, ou null quando nada muda. */
function reorder(items: TextSummary[], from: number, to: number): TextSummary[] | null {
  if (from < 0 || to < 0 || to >= items.length || from === to) return null;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

function ChevronUp({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`size-4 ${className}`}
    >
      <path d="m7 14 5-5 5 5" />
    </svg>
  );
}
