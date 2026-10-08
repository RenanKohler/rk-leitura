"use client";

import { useMemo, useState } from "react";
import type { Paragraph } from "@/lib/reading";
import { LITTLE_CONTEXT } from "@/lib/summaries";
import { contextAround, namesInText, type NameEntry } from "@/lib/xray";

/**
 * Painel de nomes do texto (PROD-11): quem aparece, quantas vezes e onde.
 *
 * Feito para entrar numa aba de "Navegar no texto": recebe as palavras e os
 * paragrafos ja processados pelo leitor e devolve o indice escolhido por
 * `onGo`, sem saber nada de modo de leitura. Toque no nome abre as
 * ocorrencias com um pedaco de contexto; toque na ocorrencia leva ate ela.
 *
 * `descriptions` (US-132) acrescenta, embaixo de cada nome, quem ele e ate
 * onde a leitura foi; null vira "Pouco contexto ate aqui".
 */
export function XrayPanel({
  words,
  paragraphs,
  onGo,
  names: given,
  descriptions,
}: {
  words: string[];
  paragraphs: Paragraph[];
  onGo: (index: number) => void;
  /** Lista ja calculada por quem envolve o painel. */
  names?: NameEntry[];
  descriptions?: Record<string, string | null> | null;
}) {
  const names = useMemo(
    () => given ?? namesInText(words, paragraphs),
    [given, words, paragraphs]
  );
  const [open, setOpen] = useState<string | null>(null);

  if (names.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted" data-testid="xray-vazio">
        Nenhum nome aparece três vezes ou mais neste texto.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5" aria-label="Nomes no texto" data-testid="xray-lista">
      {names.map((entry) => {
        const expanded = open === entry.name;
        const panelId = `xray-${entry.positions[0]}`;
        return (
          <li key={entry.name} className="rounded-2xl border border-border">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setOpen(expanded ? null : entry.name)}
              className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left"
            >
              <span className="font-medium">{entry.name}</span>
              <span className="tabular text-sm text-muted">
                {entry.count} {entry.count === 1 ? "vez" : "vezes"}
              </span>
            </button>
            {descriptions && entry.name in descriptions ? (
              <p className="px-3 pb-2 text-sm text-muted" data-testid="xray-descricao">
                {descriptions[entry.name] ?? LITTLE_CONTEXT}
              </p>
            ) : null}
            {expanded ? (
              <ol id={panelId} className="space-y-1 border-t border-border px-2 py-2">
                {entry.positions.map((index) => (
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => onGo(index)}
                      className="w-full rounded-xl px-2 py-1.5 text-left text-sm text-muted hover:bg-surface-2"
                    >
                      {contextAround(words, index)}
                    </button>
                  </li>
                ))}
                {entry.count > entry.positions.length ? (
                  <li className="px-2 py-1 text-xs text-faint">
                    {`e mais ${entry.count - entry.positions.length} ocorrências`}
                  </li>
                ) : null}
              </ol>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
