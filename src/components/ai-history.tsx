"use client";

import { useState } from "react";
import { apiGet } from "@/lib/client";
import { Alert, Button, Sheet, Skeleton } from "@/components/ui";

interface HistoryEntry {
  id: string;
  createdAt: string;
  featureLabel: string;
  textLabel: string;
  wordsSent: number;
  outcome: string;
  outcomeLabel: string;
}

const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function words(count: number): string {
  return count === 1 ? "1 palavra" : `${count.toLocaleString("pt-BR")} palavras`;
}

/**
 * Historico de envios (US-144): as ultimas 50 chamadas a IA, para o leitor
 * conferir que so saiu do app o que pediu. Carrega ao abrir a folha, nunca
 * antes: a maioria das visitas a Ajustes nao precisa dele.
 */
export function AiHistory() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState("");

  const show = () => {
    setOpen(true);
    setEntries(null);
    setError("");
    void apiGet<{ entries: HistoryEntry[] }>("/api/ia/historico")
      .then((data) => setEntries(data.entries))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Não foi possível carregar o histórico.")
      );
  };

  return (
    <>
      <Button variant="secondary" full onClick={show}>
        Histórico de envios
      </Button>
      <Sheet open={open} title="Histórico de envios" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-muted">
            As últimas 50 chamadas ao serviço de IA. O conteúdo enviado não fica guardado; só a
            função, o texto e quantas palavras foram.
          </p>
          {error ? (
            <Alert>{error}</Alert>
          ) : entries === null ? (
            <Skeleton className="h-24 w-full" />
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted" data-testid="ia-historico-vazio">
              Nenhum envio registrado.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="ia-historico">
              {entries.map((entry) => (
                <li key={entry.id} className="space-y-0.5 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{entry.featureLabel}</span>
                    <time className="tabular shrink-0 text-xs text-muted" dateTime={entry.createdAt}>
                      {DATE_FORMAT.format(new Date(entry.createdAt))}
                    </time>
                  </div>
                  <p className="truncate text-muted">{entry.textLabel}</p>
                  <p className="tabular text-xs text-faint">
                    {words(entry.wordsSent)} · {entry.outcomeLabel}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>
    </>
  );
}
