"use client";

import { useMemo } from "react";
import { MIN_CITATIONS, stripCitations } from "@/lib/citations";
import { formatNumber } from "@/lib/reading";

/**
 * Aviso das referencias que a importacao vai omitir, com a opcao de mante-las.
 *
 * So aparece quando o texto parece artigo cientifico. A limpeza de fato e do
 * servidor; aqui a conta e so para o leitor saber o que muda.
 */
export function CitationsOption({
  content,
  keep,
  onChange,
}: {
  content: string;
  keep: boolean;
  onChange: (keep: boolean) => void;
}) {
  const result = useMemo(() => stripCitations(content), [content]);
  if (result.removed < MIN_CITATIONS) return null;

  return (
    <label className="flex min-h-11 items-start gap-3 text-sm" data-testid="referencias">
      <input
        type="checkbox"
        className="mt-0.5 size-5 accent-[var(--color-accent)]"
        checked={!keep}
        onChange={(event) => onChange(!event.target.checked)}
      />
      <span>
        Omitir as referencias do corpo do texto
        <span className="block text-faint">
          {`${formatNumber(result.removed)} citacoes como [12] e (Silva, 2020) saem da leitura`}
          {result.referencesCut ? ", junto com a lista de referencias do fim." : "."}
        </span>
      </span>
    </label>
  );
}
