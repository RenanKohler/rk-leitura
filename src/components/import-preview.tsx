"use client";

import { splitParagraphs, type Leftover } from "@/lib/import-analysis";

/** Trecho mostrado na previa quando nao ha marcacao: o comeco basta. */
const PREVIEW_CHARS = 2000;

/**
 * Previa do conteudo importado.
 *
 * Sem marcacoes, mostra o comeco do texto como sempre mostrou. Com elas
 * (US-136), mostra todos os paragrafos, porque o "leia tambem" costuma estar
 * no fim: os apontados como resto aparecem riscados, cada um com o botao que
 * o devolve ao texto salvo.
 */
export function ImportPreviewContent({
  content,
  leftovers,
  kept,
  onToggle,
}: {
  content: string;
  leftovers: Leftover[];
  /** Indices de paragrafos marcados que a pessoa decidiu manter. */
  kept: ReadonlySet<number>;
  onToggle: (index: number) => void;
}) {
  const box =
    "max-h-64 overflow-y-auto rounded-2xl border border-border bg-bg p-4 text-sm leading-relaxed text-muted";

  if (leftovers.length === 0) {
    return (
      <div className={box}>
        {content.slice(0, PREVIEW_CHARS)}
        {content.length > PREVIEW_CHARS ? "..." : ""}
      </div>
    );
  }

  const marked = new Map(leftovers.map((item) => [item.index, item.reason]));

  return (
    <div className={`${box} space-y-3`} data-testid="previa-marcada">
      {splitParagraphs(content).map((paragraph, index) => {
        const reason = marked.get(index);
        if (reason === undefined) return <p key={index}>{paragraph}</p>;

        const removed = !kept.has(index);
        return (
          <div
            key={index}
            className="space-y-1.5 rounded-xl border border-dashed border-border p-2.5"
            data-testid="resto-de-pagina"
          >
            <p className={removed ? "text-faint line-through" : undefined}>{paragraph}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">
                {removed ? "Provável resto de página" : "Mantido no texto"}
                {` · ${reason}`}
              </span>
              <button
                type="button"
                onClick={() => onToggle(index)}
                aria-pressed={!removed}
                className="flex min-h-9 items-center rounded-full border border-border px-3 text-xs font-medium text-ink"
              >
                {removed ? "Manter" : "Remover"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
