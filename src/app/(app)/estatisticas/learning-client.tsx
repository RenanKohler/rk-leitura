"use client";

import { Card, SectionTitle } from "@/components/ui";
import { TrendChart } from "@/components/trend-chart";
import { isSessionMode, SESSION_MODE_LABELS } from "@/lib/difficulty";
import type { LearningStats } from "@/lib/types";

/**
 * Ritmo por modo e compreensao (PROD-10, PROD-13).
 *
 * O ritmo medio geral mistura coisas que nao se comparam: a narracao anda no
 * passo da voz, a pagina no passo de quem vira. Separado por modo, cada
 * numero diz algo. A compreensao so aparece quando houve questionario ou
 * lacunas respondidos - uma serie vazia seria so um grafico de zeros.
 */
export function LearningClient({ stats }: { stats: LearningStats }) {
  const modes = stats.byMode.filter((row) => row.sessions > 0);
  const points = stats.comprehension;

  if (modes.length === 0 && points.length === 0) return null;

  const last = points.at(-1);

  return (
    <div className="space-y-4">
      {modes.length > 0 ? (
        <section className="space-y-3" aria-labelledby="ritmo-por-modo">
          <SectionTitle>
            <span id="ritmo-por-modo">Ritmo por modo, 30 dias</span>
          </SectionTitle>
          <div className="grid grid-cols-3 gap-2" data-testid="ritmo-por-modo">
            {modes.map((row) => (
              <Card key={row.mode} className="p-3">
                <p className="text-xs text-muted">
                  {isSessionMode(row.mode) ? SESSION_MODE_LABELS[row.mode] : row.mode}
                </p>
                <p className="tabular text-xl font-semibold">
                  {row.wpm}
                  <span className="ml-1 text-xs font-normal text-muted">ppm</span>
                </p>
                <p className="tabular text-xs text-faint">
                  {row.sessions} {row.sessions === 1 ? "sessão" : "sessões"}
                </p>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {points.length > 0 ? (
        <section className="space-y-3" aria-labelledby="compreensao">
          <SectionTitle>
            <span id="compreensao">Compreensão</span>
          </SectionTitle>
          {last ? (
            <p className="text-sm text-muted" data-testid="ritmo-eficaz">
              {`Última medida: ${last.percent}% de acertos a ${last.wpm} ppm, ritmo eficaz de ${last.effectiveWpm} ppm.`}
            </p>
          ) : null}
          {/* O grafico so recebe o valor; dia e rotulo seguem o formato das
              outras series. */}
          <Card className="p-5">
            <TrendChart
              points={points.map((point) => ({
                day: point.day,
                minutes: 0,
                words: 0,
                wpm: point.percent,
              }))}
              metric="wpm"
              shape="linha"
              label="Acertos"
              unit="%"
              weekly={false}
            />
          </Card>
          <Card className="p-5">
            <TrendChart
              points={points.map((point) => ({
                day: point.day,
                minutes: 0,
                words: 0,
                wpm: point.effectiveWpm,
              }))}
              metric="wpm"
              shape="linha"
              label="Ritmo eficaz (ppm x acertos)"
              unit="ppm"
              weekly={false}
            />
          </Card>
        </section>
      ) : null}
    </div>
  );
}
