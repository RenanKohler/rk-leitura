"use client";

import { useId, useState } from "react";
import type { TrendPoint } from "@/lib/types";

/**
 * Grafico de uma serie so, em SVG proprio.
 *
 * Duas medidas de escalas diferentes - minutos e ppm - nao dividem um mesmo
 * par de eixos: cada uma tem o seu grafico. Um segundo eixo a direita faria a
 * posicao relativa das duas curvas depender da escala escolhida, e nao dos
 * dados.
 *
 * Uma biblioteca de graficos custaria mais bundle do que o desenho de uma
 * serie, e a tela ja carrega o leitor inteiro.
 */

const WIDTH = 320;
const HEIGHT = 120;
const PAD = { top: 10, right: 6, bottom: 18, left: 30 };

const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

export type TrendShape = "barras" | "linha";

export function TrendChart({
  points,
  metric,
  shape,
  label,
  unit,
  weekly,
}: {
  points: TrendPoint[];
  metric: "minutes" | "wpm";
  shape: TrendShape;
  label: string;
  unit: string;
  weekly: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();

  const values = points.map((point) => point[metric]);
  const max = Math.max(1, ...values);
  // Escala sempre da zero: comecar do minimo exagera variacao pequena.
  const y = (value: number) => PAD.top + PLOT_H - (value / max) * PLOT_H;
  const x = (index: number) =>
    PAD.left + (points.length <= 1 ? PLOT_W / 2 : (index / (points.length - 1)) * PLOT_W);

  const shown = active !== null ? points[active] : null;

  return (
    <figure className="space-y-2">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="tabular text-sm text-muted">
          {shown
            ? `${formatDay(shown.day, weekly)} · ${shown[metric]} ${unit}`
            : `maximo ${max} ${unit}`}
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-32 w-full"
        role="img"
        aria-labelledby={titleId}
        onPointerLeave={() => setActive(null)}
      >
        <title id={titleId}>{`${label}, ${points.length} pontos`}</title>

        {/* Grade discreta: tres linhas bastam para dar referencia sem competir
            com os dados. */}
        {[0, 0.5, 1].map((fraction) => (
          <line
            key={fraction}
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={PAD.top + PLOT_H * fraction}
            y2={PAD.top + PLOT_H * fraction}
            stroke="currentColor"
            className="text-border"
            strokeWidth={1}
          />
        ))}

        <text x={0} y={PAD.top + 4} className="fill-faint text-[9px]">
          {max}
        </text>
        <text x={0} y={PAD.top + PLOT_H + 4} className="fill-faint text-[9px]">
          0
        </text>

        {shape === "barras" ? (
          <Bars points={points} metric={metric} y={y} active={active} onHover={setActive} />
        ) : (
          <Line points={points} metric={metric} x={x} y={y} active={active} onHover={setActive} />
        )}

        {/* Alvos de toque mais largos que a marca: no celular o dedo cobre
            varios pontos de uma vez. */}
        {points.map((point, index) => (
          <rect
            key={point.day}
            x={PAD.left + (index / points.length) * PLOT_W}
            y={0}
            width={PLOT_W / points.length}
            height={HEIGHT}
            fill="transparent"
            onPointerEnter={() => setActive(index)}
            onPointerDown={() => setActive(index)}
          />
        ))}
      </svg>

      <div className="tabular flex justify-between text-xs text-faint">
        <span>{points.length > 0 ? formatDay(points[0]!.day, weekly) : ""}</span>
        <span>{points.length > 1 ? formatDay(points[points.length - 1]!.day, weekly) : ""}</span>
      </div>
    </figure>
  );
}

function Bars({
  points,
  metric,
  y,
  active,
  onHover,
}: {
  points: TrendPoint[];
  metric: "minutes" | "wpm";
  y: (value: number) => number;
  active: number | null;
  onHover: (index: number | null) => void;
}) {
  const slot = PLOT_W / points.length;
  // 2px de folga entre barras vizinhas: sem isso elas leem como um bloco so.
  const width = Math.max(2, slot - 2);

  return (
    <g>
      {points.map((point, index) => {
        const value = point[metric];
        if (value <= 0) return null;

        const top = y(value);
        return (
          <rect
            key={point.day}
            x={PAD.left + index * slot + (slot - width) / 2}
            y={top}
            width={width}
            height={Math.max(2, PAD.top + PLOT_H - top)}
            rx={Math.min(2, width / 2)}
            className="fill-[var(--color-chart)]"
            opacity={active === null || active === index ? 1 : 0.45}
            onPointerEnter={() => onHover(index)}
          />
        );
      })}
    </g>
  );
}

function Line({
  points,
  metric,
  x,
  y,
  active,
  onHover,
}: {
  points: TrendPoint[];
  metric: "minutes" | "wpm";
  x: (index: number) => number;
  y: (value: number) => number;
  active: number | null;
  onHover: (index: number | null) => void;
}) {
  // Dia sem leitura interrompe a linha em vez de ser ligado ao proximo: unir
  // os dois lados desenharia um ritmo que nunca existiu.
  const segments: { index: number; point: TrendPoint }[][] = [];
  let run: { index: number; point: TrendPoint }[] = [];

  points.forEach((point, index) => {
    if (point[metric] > 0) {
      run.push({ index, point });
    } else if (run.length > 0) {
      segments.push(run);
      run = [];
    }
  });
  if (run.length > 0) segments.push(run);

  return (
    <g>
      {segments.map((segment) => (
        <polyline
          key={segment[0]!.index}
          points={segment.map(({ index, point }) => `${x(index)},${y(point[metric])}`).join(" ")}
          fill="none"
          className="stroke-[var(--color-chart)]"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}

      {segments.flat().map(({ index, point }) => (
        <circle
          key={point.day}
          cx={x(index)}
          cy={y(point[metric])}
          r={active === index ? 5 : 2.5}
          className="fill-[var(--color-chart)]"
          onPointerEnter={() => onHover(index)}
        />
      ))}
    </g>
  );
}

function formatDay(day: string, weekly: boolean): string {
  const [year, month, date] = day.split("-");
  const curto = `${date}/${month}`;
  return weekly ? `semana de ${curto}` : `${curto}/${year!.slice(2)}`;
}
