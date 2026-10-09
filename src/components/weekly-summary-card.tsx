"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/client";
import { Alert, Button, Card, SectionTitle } from "@/components/ui";
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

  return <SummaryBody summary={summary} onDismiss={() => setVisible(false)} />;
}

/** Estado das ideias da semana (US-154), vindo de GET /api/resumo-semanal/ideias. */
interface IdeasState {
  available: boolean;
  ideas: string | null;
}

function SummaryBody({ summary, onDismiss }: { summary: WeeklySummary; onDismiss: () => void }) {
  // Sem resposta, o cartao fica como sempre foi: so os numeros.
  const [ideasState, setIdeasState] = useState<IdeasState | null>(null);
  const [ideas, setIdeas] = useState<string | null>(null);
  const [loadingIdeas, setLoadingIdeas] = useState(false);
  const [ideasError, setIdeasError] = useState("");

  useEffect(() => {
    let active = true;
    void apiGet<IdeasState>("/api/resumo-semanal/ideias")
      .then((state) => {
        if (active) setIdeasState(state);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const showIdeas = async () => {
    // Guardado da mesma semana: aparece sem nova chamada.
    if (ideasState?.ideas) {
      setIdeas(ideasState.ideas);
      return;
    }
    setLoadingIdeas(true);
    setIdeasError("");
    try {
      const result = await apiSend<{ ideas: string }>("/api/resumo-semanal/ideias", "POST");
      setIdeas(result.ideas);
    } catch (cause) {
      setIdeasError(cause instanceof Error ? cause.message : "Não consegui reunir as ideias agora.");
    } finally {
      setLoadingIdeas(false);
    }
  };

  const dismiss = () => {
    onDismiss();
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
        <Figure label="Ritmo médio" value={`${summary.wpm} ppm`} change={summary.wpmChange} />
        <Figure label="Palavras" value={formatNumber(summary.words)} />
        <Figure
          label="Textos concluídos"
          value={formatNumber(summary.texts)}
        />
      </div>

      {/* Largar um texto fraco conta como ganho, nao como fracasso (US-81). */}
      {summary.savedMinutes > 0 ? (
        <p className="text-sm text-muted">
          {`${formatNumber(summary.savedMinutes)} min economizados ao largar textos que não valiam a leitura.`}
        </p>
      ) : null}

      {ideas ? (
        <div className="space-y-1" data-testid="ideias-semana">
          <p className="text-sm font-medium text-muted">Ideias da semana</p>
          <p className="text-sm leading-relaxed">{ideas}</p>
        </div>
      ) : ideasState?.available ? (
        <div className="space-y-2">
          {ideasError ? <Alert>{ideasError}</Alert> : null}
          <Button variant="secondary" full loading={loadingIdeas} onClick={() => void showIdeas()}>
            Ver as ideias da semana
          </Button>
        </div>
      ) : null}

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
