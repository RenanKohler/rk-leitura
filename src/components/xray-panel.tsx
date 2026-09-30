"use client";

import { useMemo, useState } from "react";
import type { Paragraph } from "@/lib/reading";
import { contextAround, namesInText } from "@/lib/xray";

/**
 * Painel de nomes do texto (PROD-11): quem aparece, quantas vezes e onde.
 *
 * Feito para entrar numa aba de "Navegar no texto": recebe as palavras e os
 * paragrafos ja processados pelo leitor e devolve o indice escolhido por
 * `onGo`, sem saber nada de modo de leitura. Toque no nome abre as
 * ocorrencias com um pedaco de contexto; toque na ocorrencia leva ate ela.
 */
export function XrayPanel({
  words,
  paragraphs,
  onGo,
}: {
  words: string[];
  paragraphs: Paragraph[];
  onGo: (index: number) => void;
}) {
  const names = useMemo(() => namesInText(words, paragraphs), [words, paragraphs]);
  const [open, setOpen] = useState<string | null>(null);

  if (names.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted" data-testid="xray-vazio">
        Nenhum nome aparece tres vezes ou mais neste texto.
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
                    {`e mais ${entry.count - entry.positions.length} ocorrencias`}
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
