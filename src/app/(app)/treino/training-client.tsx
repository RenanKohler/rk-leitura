"use client";

import { useState } from "react";
import Link from "next/link";
import { apiSend } from "@/lib/client";
import { useSettings, useToast } from "@/components/providers";
import { PlacementTest } from "@/components/placement-test";
import { Alert, Button, Card, SectionTitle } from "@/components/ui";
import { CheckIcon, SpeedIcon } from "@/components/icons";
import { formatDate } from "@/lib/reading";
import {
  finalTarget,
  MIN_TRAINING_WORDS,
  PROGRAM_LENGTHS,
  type ProgramLength,
  type ProgramStatus,
} from "@/lib/training";

/**
 * Teste de velocidade e programa de treino.
 *
 * As duas coisas moram na mesma tela porque sao a mesma pergunta em dois
 * momentos: em que ritmo eu leio hoje, e como saio daqui.
 */
export function TrainingClient({
  placementWpm,
  baseWpm,
  program: initial,
}: {
  placementWpm: number | null;
  baseWpm: number;
  program: ProgramStatus | null;
}) {
  const notify = useToast();
  const { save } = useSettings();
  const [program, setProgram] = useState(initial);
  const [measured, setMeasured] = useState(placementWpm);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const start = async (length: ProgramLength) => {
    setBusy(true);
    setError("");
    try {
      const data = await apiSend<{ program: ProgramStatus }>("/api/treino", "POST", { length });
      setProgram(data.program);
      // A tela de leitura le a velocidade das preferencias; o programa acabou
      // de muda-la no servidor.
      await save({ baseWpm: data.program.targetWpm });
      notify("Programa iniciado.", "success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao consegui comecar o programa.");
    } finally {
      setBusy(false);
    }
  };

  const abandon = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await apiSend<{ baseWpm: number }>("/api/treino", "DELETE");
      setProgram(null);
      setConfirming(false);
      await save({ baseWpm: data.baseWpm });
      notify(`Programa abandonado. Velocidade de volta em ${data.baseWpm} ppm.`, "info");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao consegui abandonar.");
    } finally {
      setBusy(false);
    }
  };

  const startWpm = measured ?? baseWpm;

  return (
    <div className="space-y-6">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Treino</h1>
        <p className="mt-1 text-sm text-muted">
          {measured
            ? `Seu teste mediu ${measured} ppm.`
            : "Comece medindo em que ritmo voce le hoje."}
        </p>
      </header>

      {error ? <Alert>{error}</Alert> : null}

      {program ? (
        <ProgramCard
          program={program}
          busy={busy}
          confirming={confirming}
          onConfirm={() => setConfirming(true)}
          onCancel={() => setConfirming(false)}
          onAbandon={() => void abandon()}
        />
      ) : (
        <>
          <PlacementTest onApplied={(wpm) => setMeasured(wpm)} />

          <div>
            <SectionTitle>Programa progressivo</SectionTitle>
            <Card className="mt-3 space-y-4 p-5">
              <p className="text-sm text-muted">
                {`Cada dia define uma velocidade alvo a partir de ${startWpm} ppm. Uma leitura de pelo menos ${MIN_TRAINING_WORDS} palavras no alvo cumpre o dia; se a compreensao cair abaixo de 60%, o alvo do dia seguinte nao sobe.`}
              </p>

              <div className="grid grid-cols-2 gap-2">
                {PROGRAM_LENGTHS.map((length) => (
                  <button
                    key={length}
                    type="button"
                    disabled={busy}
                    onClick={() => void start(length)}
                    className="rounded-2xl border border-border p-4 text-left transition-colors hover:border-border-strong disabled:opacity-45"
                  >
                    <p className="font-semibold">{`${length} dias`}</p>
                    <p className="tabular mt-1 text-sm text-muted">
                      {`ate ${finalTarget(startWpm, length)} ppm`}
                    </p>
                    <p className="mt-0.5 text-xs text-faint">
                      {length === 14 ? "ritmo mais exigente" : "subida mais suave"}
                    </p>
                  </button>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function ProgramCard({
  program,
  busy,
  confirming,
  onConfirm,
  onCancel,
  onAbandon,
}: {
  program: ProgramStatus;
  busy: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onAbandon: () => void;
}) {
  const percent = Math.round((program.days.length / program.length) * 100);

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted">
              {program.finished
                ? "Programa concluido"
                : `Dia ${program.currentDay} de ${program.length}`}
            </p>
            <p className="tabular mt-0.5 text-3xl font-semibold">
              {`${program.targetWpm} ppm`}
            </p>
            <p className="text-sm text-muted">
              {program.finished
                ? "velocidade final"
                : program.doneToday
                  ? "alvo de hoje, ja cumprido"
                  : "alvo de hoje"}
            </p>
          </div>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <SpeedIcon className="size-5" />
          </div>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
        </div>

        {program.finished ? (
          <p className="text-sm text-muted">
            {`Voce saiu de ${program.startWpm} ppm e chegou a ${program.targetWpm} ppm em ${program.length} dias.`}
          </p>
        ) : program.doneToday ? (
          <p className="flex items-center gap-2 text-sm font-medium text-positive">
            <CheckIcon className="size-5" />
            Dia cumprido. O proximo abre amanha.
          </p>
        ) : (
          <Link href="/textos" className="block">
            <Button size="lg" full>
              Escolher um texto para hoje
            </Button>
          </Link>
        )}
      </Card>

      {program.days.length > 0 ? (
        <div>
          <SectionTitle>Dias cumpridos</SectionTitle>
          <ul className="mt-3 space-y-1.5">
            {[...program.days].reverse().map((day) => (
              <li
                key={day.day}
                className="flex items-center gap-3 rounded-2xl border border-border px-3 py-2.5"
              >
                <span className="tabular w-8 shrink-0 text-sm text-faint">{day.day}</span>
                <div className="min-w-0 flex-1">
                  <p className="tabular text-sm font-medium">
                    {`${day.wpm} ppm`}
                    <span className="text-muted">{` · alvo ${day.targetWpm}`}</span>
                  </p>
                  <p className="text-xs text-faint">{formatDate(day.onDay)}</p>
                </div>
                {day.comprehension !== null ? (
                  <span
                    className={`tabular shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
                      day.comprehension < 60
                        ? "bg-danger-soft text-danger"
                        : "bg-positive-soft text-positive"
                    }`}
                  >
                    {`${day.comprehension}%`}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {confirming ? (
        <Card className="space-y-3 p-4">
          <p className="text-sm text-muted">
            {`Abandonar devolve a velocidade para ${program.previousWpm} ppm e encerra o programa. Os dias cumpridos ficam no historico.`}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" full onClick={onCancel}>
              Continuar o programa
            </Button>
            <Button variant="danger" full loading={busy} onClick={onAbandon}>
              Abandonar
            </Button>
          </div>
        </Card>
      ) : (
        <Button variant="ghost" size="lg" full onClick={onConfirm}>
          {program.finished ? "Encerrar o programa" : "Abandonar o programa"}
        </Button>
      )}
    </div>
  );
}
