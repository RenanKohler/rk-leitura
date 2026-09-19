"use client";

import { useState } from "react";
import { Card, EmptyState, LinkButton, Segmented } from "@/components/ui";
import { SpeedIcon } from "@/components/icons";
import { TrendChart } from "@/components/trend-chart";
import { formatNumber } from "@/lib/reading";
import type { TrendData } from "@/lib/types";

type Period = "30-dias" | "6-meses";

/** Abaixo disso a linha vira ruido em vez de tendencia. */
const MIN_SESSIONS = 3;

export function TrendClient({ trend }: { trend: TrendData }) {
  const [period, setPeriod] = useState<Period>("30-dias");
  const [showTable, setShowTable] = useState(false);

  const weekly = period === "6-meses";
  const points = weekly ? trend.weekly : trend.daily;

  if (trend.sessions < MIN_SESSIONS) {
    return (
      <div className="space-y-6">
        <Header />
        <Card>
          <EmptyState
            icon={<SpeedIcon className="size-7" />}
            title="Dados insuficientes"
            description={`Com ${trend.sessions} ${trend.sessions === 1 ? "sessao" : "sessoes"} ainda nao da para falar em evolucao. Leia mais um pouco e o grafico aparece.`}
            action={<LinkButton href="/textos">Ir para a biblioteca</LinkButton>}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />

      <Segmented<Period>
        label="Periodo"
        value={period}
        onChange={setPeriod}
        options={[
          { value: "30-dias", label: "30 dias" },
          { value: "6-meses", label: "6 meses" },
        ]}
      />

      <Card className="p-5">
        <TrendChart
          points={points}
          metric="minutes"
          shape="barras"
          label="Minutos lidos"
          unit="min"
          weekly={weekly}
        />
      </Card>

      <Card className="p-5">
        <TrendChart
          points={points}
          metric="wpm"
          shape="linha"
          label="Ritmo medio"
          unit="ppm"
          weekly={weekly}
        />
      </Card>

      {/* Os mesmos numeros em texto: um grafico sozinho nao e legivel por
          leitor de tela nem copiavel. */}
      <Card className="space-y-3 p-5">
        <button
          type="button"
          onClick={() => setShowTable((value) => !value)}
          className="flex min-h-11 w-full items-center justify-between text-sm font-medium"
          aria-expanded={showTable}
        >
          Ver os numeros
          <span className="text-muted">{showTable ? "Ocultar" : "Mostrar"}</span>
        </button>

        {showTable ? (
          <div className="overflow-x-auto">
            <table className="tabular w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {weekly ? "Semana" : "Dia"}
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Minutos
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Palavras
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    ppm
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...points]
                  .reverse()
                  .filter((point) => point.minutes > 0 || point.words > 0)
                  .map((point) => (
                    <tr key={point.day} className="border-t border-border">
                      <td className="py-1.5 pr-3">{point.day}</td>
                      <td className="py-1.5 pr-3">{point.minutes}</td>
                      <td className="py-1.5 pr-3">{formatNumber(point.words)}</td>
                      <td className="py-1.5">{point.wpm}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function Header() {
  return (
    <header className="pt-2">
      <h1 className="text-2xl font-semibold tracking-tight">Estatisticas</h1>
      <p className="mt-1 text-sm text-muted">Como o seu ritmo mudou ao longo do tempo.</p>
    </header>
  );
}
