"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/client";
import { Card, LinkButton, SectionTitle, Spinner } from "@/components/ui";
import { formatNumber } from "@/lib/reading";
import type { TimeWindow } from "@/lib/types";

export const FREE_TIME_OPTIONS = [5, 10, 20] as const;

function minutesLabel(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `~${minutes} min`;
}

/**
 * "Tenho X minutos" (US-84).
 *
 * O leitor diz quanto tempo tem e recebe ate tres leituras que cabem nele, no
 * ritmo real (US-83). Cada sugestao abre o leitor com o ponto de parada e o
 * tempo previsto na URL, para a tela comparar com o real no fim (US-85).
 */
export function FreeTimeCard({
  minutes,
  onChoose,
}: {
  minutes: number | null;
  onChoose: (minutes: number) => void;
}) {
  const [result, setResult] = useState<{ minutes: number; data: TimeWindow } | null>(null);
  const [error, setError] = useState<{ minutes: number; message: string } | null>(null);

  useEffect(() => {
    if (minutes === null) return;
    let active = true;
    void apiGet<TimeWindow>(`/api/tempo-livre?min=${minutes}`)
      .then((data) => {
        if (active) setResult({ minutes, data });
      })
      .catch((cause: unknown) => {
        if (active) {
          setError({
            minutes,
            message: cause instanceof Error ? cause.message : "Nao consegui sugerir agora.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [minutes]);

  const current = result && result.minutes === minutes ? result.data : null;
  const failed = error && error.minutes === minutes ? error.message : null;
  const loading = minutes !== null && !current && !failed;

  return (
    // A ancora fica num involucro: o atalho da meta rola ate aqui (US-86).
    <div id="tempo-livre" className="scroll-mt-4">
      <Card className="space-y-4 p-5">
        <SectionTitle>Quanto tempo voce tem?</SectionTitle>

        <div role="group" aria-label="Tempo livre" className="grid grid-cols-3 gap-2">
          {FREE_TIME_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={minutes === option}
              onClick={() => onChoose(option)}
              className={`min-h-11 rounded-full border text-sm font-medium transition-colors ${
                minutes === option
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border text-muted hover:text-ink"
              }`}
            >
              {option} min
            </button>
          ))}
        </div>

        {minutes !== null && !FREE_TIME_OPTIONS.includes(minutes as 5 | 10 | 20) ? (
          <p className="text-sm text-muted">{`Sugestoes para ${minutes} min.`}</p>
        ) : null}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner />
            Procurando leituras que cabem no tempo
          </p>
        ) : null}

        {failed ? <p className="text-sm text-danger">{failed}</p> : null}

        {current ? (
          current.suggestions.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">Nenhum texto para sugerir.</p>
              <LinkButton href="/textos/novo" variant="secondary">
                Importar um texto
              </LinkButton>
            </div>
          ) : (
            <>
              <ul className="space-y-2">
                {current.suggestions.map((item) => (
                  <li key={item.textId}>
                    <Link
                      href={`/leitor/${item.textId}?ate=${item.end}&previsto=${item.predictedMs}`}
                      className="block rounded-2xl border border-border p-3 hover:border-border-strong"
                    >
                      <p className="font-medium leading-snug">{item.title}</p>
                      <p className="mt-1 text-sm text-muted">
                        {`${minutesLabel(item.predictedMs)} · ${
                          item.finishes
                            ? "ate o fim do texto"
                            : `${formatNumber(item.end - item.from)} palavras, ate o fim de um paragrafo`
                        }${item.source === "fila" ? " · da fila" : ""}`}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-faint">
                {current.pace.fromSettings
                  ? `Estimativa pela velocidade configurada (${current.pace.wpm} ppm).`
                  : `Pelo seu ritmo real nas ultimas leituras: ${current.pace.wpm} ppm.`}
              </p>
            </>
          )
        ) : null}
      </Card>
    </div>
  );
}
