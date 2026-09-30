"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { yearGrid, type CalendarDay } from "@/lib/calendar";

const DAY = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const WEEKDAYS = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];

function label(cell: CalendarDay): string {
  const date = DAY.format(new Date(`${cell.day}T12:00:00Z`));
  return cell.minutes > 0 ? `${date}: ${cell.minutes} min` : `${date}: sem leitura`;
}

/**
 * Calendario do ultimo ano (US-102): uma coluna por semana, a cor pela
 * quantidade de minutos lidos no dia, no fuso do leitor.
 *
 * Acessibilidade (A11Y-9): cada dia era um botao, e atravessar o calendario
 * custava 367 paradas de Tab. Agora e uma grade (role=grid) com uma parada
 * so e tabindex rotativo: as setas andam por dia (cima/baixo) e por semana
 * (esquerda/direita), Home e End vao ao primeiro e ao ultimo dia. O resumo em
 * texto logo acima diz o essencial sem exigir percorrer a grade.
 */
export function YearCalendar({ days, today }: { days: { day: string; minutes: number }[]; today: string }) {
  const weeks = useMemo(() => yearGrid(days, today), [days, today]);
  // Dias em ordem, sem os futuros que so completam a ultima coluna. A posicao
  // nesta lista e o que as setas movem.
  const flat = useMemo(() => weeks.flat().filter((cell) => !cell.future), [weeks]);
  const [selected, setSelected] = useState<CalendarDay | null>(null);
  // Parada de Tab: o dia escolhido, ou hoje.
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());

  const active = focusIndex ?? flat.length - 1;
  const activeDay = flat[active]?.day;

  const read = flat.filter((cell) => cell.minutes > 0);
  const empty = read.length === 0;
  const totalMinutes = read.reduce((sum, cell) => sum + cell.minutes, 0);
  const best = read.reduce<CalendarDay | null>(
    (top, cell) => (top === null || cell.minutes > top.minutes ? cell : top),
    null
  );

  const summary = empty
    ? "Nenhuma leitura neste ano."
    : `${read.length} ${read.length === 1 ? "dia" : "dias"} com leitura, ${totalMinutes} min no total.` +
      (best ? ` Dia com mais leitura: ${label(best)}.` : "");

  const move = (index: number) => {
    const next = Math.max(0, Math.min(flat.length - 1, index));
    const cell = flat[next];
    if (!cell) return;
    setFocusIndex(next);
    setSelected(cell);
    cellRefs.current.get(cell.day)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step: Record<string, number> = {
      ArrowUp: -1,
      ArrowDown: 1,
      ArrowLeft: -7,
      ArrowRight: 7,
    };
    if (event.key in step) {
      event.preventDefault();
      move(active + step[event.key]!);
    } else if (event.key === "Home") {
      event.preventDefault();
      move(0);
    } else if (event.key === "End") {
      event.preventDefault();
      move(flat.length - 1);
    }
  };

  return (
    <Card className="space-y-3 p-5">
      <SectionTitle>Ultimo ano</SectionTitle>
      <p className="text-sm text-muted" id="calendario-resumo">
        {summary}
      </p>
      <p className="text-sm text-muted" aria-live="polite">
        {selected ? label(selected) : empty ? "" : "Toque em um dia, ou use as setas, para ver os minutos."}
      </p>

      <div className="overflow-x-auto pb-1" data-testid="calendario">
        <div
          role="grid"
          aria-label="Minutos lidos por dia no ultimo ano"
          aria-describedby="calendario-resumo"
          onKeyDown={onKeyDown}
          className="inline-flex flex-col gap-[3px]"
        >
          {WEEKDAYS.map((weekday, row) => (
            <div key={weekday} role="row" aria-label={weekday} className="flex gap-[3px]">
              {weeks.map((week) => {
                const cell = week[row]!;
                if (cell.future) {
                  return <span key={cell.day} role="gridcell" aria-hidden="true" className="size-3" />;
                }
                const index = flat.indexOf(cell);
                return (
                  <div
                    key={cell.day}
                    ref={(element) => {
                      if (element) cellRefs.current.set(cell.day, element);
                      else cellRefs.current.delete(cell.day);
                    }}
                    role="gridcell"
                    aria-label={label(cell)}
                    aria-selected={selected?.day === cell.day}
                    tabIndex={cell.day === activeDay ? 0 : -1}
                    title={label(cell)}
                    data-level={cell.level}
                    onClick={() => move(index)}
                    className="calendar-cell size-3 cursor-pointer rounded-[3px]"
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-1 text-xs text-muted" aria-hidden="true">
        Menos
        {[0, 1, 2, 3, 4].map((level) => (
          <span key={level} data-level={level} className="calendar-cell size-3 rounded-[3px]" />
        ))}
        Mais
      </div>
    </Card>
  );
}
