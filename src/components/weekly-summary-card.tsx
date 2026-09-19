"use client";

import { useState } from "react";
import { apiSend } from "@/lib/client";
import { Button, Card, SectionTitle } from "@/components/ui";
import { formatNumber } from "@/lib/reading";
import type { WeeklySummary } from "@/lib/types";

/**
 * Resumo da semana anterior.
 *
 * Aparece uma vez por semana e some ao ser dispensado. A dispensa vai para o
 * servidor, nao para o armazenamento do navegador: o cartao e sobre a conta,
 * e dispensar no celular nao deveria fazer ele reaparecer no computador.
 */
export function WeeklySummaryCard({ summary }: { summary: WeeklySummary }) {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    // Sem await: o cartao ja saiu da tela, e se a gravacao falhar o pior caso
    // e ele voltar na proxima abertura.
    void apiSend("/api/resumo-semanal", "POST").catch(() => {});
  };

  return (
    <Card className="animate-rise space-y-4 p-5">
      <SectionTitle
        action={
          <button type="button" onClick={dismiss} className="min-h-11 text-sm text-muted">
            Dispensar
          </button>
        }
      >
        Semana passada
      </SectionTitle>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Figure label="Minutos" value={formatNumber(summary.minutes)} change={summary.minutesChange} />
        <Figure label="Ritmo medio" value={`${summary.wpm} ppm`} change={summary.wpmChange} />
        <Figure label="Palavras" value={formatNumber(summary.words)} />
        <Figure
          label="Textos concluidos"
          value={formatNumber(summary.texts)}
        />
      </div>

      <Button variant="ghost" full onClick={dismiss}>
        Entendi
      </Button>
    </Card>
  );
}

function Figure({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change?: number | null;
}) {
  return (
    <div>
      <p className="text-sm text-muted">{label}</p>
      <p className="tabular text-xl font-semibold">{value}</p>
      {typeof change === "number" ? (
        <p
          className={`tabular text-sm ${change >= 0 ? "text-positive" : "text-muted"}`}
          // A variacao sem a semana de referencia seria um numero sem ancora.
          title="Comparado com a semana anterior"
        >
          {change >= 0 ? "+" : ""}
          {change}% vs. semana anterior
        </p>
      ) : null}
    </div>
  );
}
