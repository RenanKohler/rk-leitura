"use client";

import { useMemo, useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { yearGrid, type CalendarDay } from "@/lib/calendar";

const DAY = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function label(cell: CalendarDay): string {
  const date = DAY.format(new Date(`${cell.day}T12:00:00Z`));
  return cell.minutes > 0 ? `${date}: ${cell.minutes} min` : `${date}: sem leitura`;
}

/**
 * Calendario do ultimo ano (US-102): uma coluna por semana, a cor pela
 * quantidade de minutos lidos no dia, no fuso do leitor.
 */
export function YearCalendar({ days, today }: { days: { day: string; minutes: number }[]; today: string }) {
  const weeks = useMemo(() => yearGrid(days, today), [days, today]);
  const [selected, setSelected] = useState<CalendarDay | null>(null);
  const empty = weeks.every((week) => week.every((cell) => cell.minutes === 0));
  const total = weeks.flat().filter((cell) => cell.minutes > 0).length;

  return (
    <Card className="space-y-3 p-5">
      <SectionTitle>Ultimo ano</SectionTitle>
      <p className="text-sm text-muted" aria-live="polite">
        {selected
          ? label(selected)
          : empty
            ? "Nenhuma leitura neste ano."
            : `${total} ${total === 1 ? "dia" : "dias"} com leitura. Toque em um dia para ver os minutos.`}
      </p>

      <div className="overflow-x-auto pb-1" data-testid="calendario">
        <div className="inline-flex gap-[3px]" role="group" aria-label="Minutos lidos por dia no ultimo ano">
          {weeks.map((week) => (
            <div key={week[0]!.day} className="flex flex-col gap-[3px]">
              {week.map((cell) =>
                cell.future ? (
                  <span key={cell.day} className="size-3" aria-hidden="true" />
                ) : (
                  <button
                    key={cell.day}
                    type="button"
                    aria-label={label(cell)}
                    title={label(cell)}
                    data-level={cell.level}
                    onClick={() => setSelected(cell)}
                    className="calendar-cell size-3 rounded-[3px]"
                  />
                )
              )}
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
