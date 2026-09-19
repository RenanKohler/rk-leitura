"use client";

import { useState } from "react";
import { apiSend } from "@/lib/client";
import { useResource } from "@/hooks/use-resource";
import { useToast } from "@/components/providers";
import { Button, Card, SectionTitle, Segmented, Sheet, Slider } from "@/components/ui";
import { SparkIcon } from "@/components/icons";
import { formatNumber } from "@/lib/reading";
import { GOAL_LIMITS, type GoalKind } from "@/lib/goals";
import type { GoalStatus } from "@/lib/types";

const KIND_OPTIONS: { value: GoalKind; label: string }[] = [
  { value: "minutos", label: "Minutos" },
  { value: "palavras", label: "Palavras" },
];

/** Passo do slider por tipo: palavras andam de 500 em 500. */
const STEP: Record<GoalKind, number> = { minutos: 5, palavras: 500 };

/**
 * Meta do dia e sequencia de dias.
 *
 * O dia e o do fuso do usuario, resolvido no servidor: contar em UTC faria
 * quem le a noite ver a leitura cair no dia seguinte e a sequencia quebrar
 * sozinha.
 */
export function GoalCard({ initial }: { initial: GoalStatus }) {
  const goal = useResource<{ goal: GoalStatus }>("/api/metas", { goal: initial });
  const status = goal.data?.goal ?? initial;

  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<GoalKind>(status.defined ? status.kind : "minutos");
  const [target, setTarget] = useState(status.defined ? status.target : 15);
  const [saving, setSaving] = useState(false);
  const notify = useToast();

  const openEditor = () => {
    setKind(status.defined ? status.kind : "minutos");
    setTarget(status.defined ? status.target : GOAL_LIMITS.minutos.min * 3);
    setEditing(true);
  };

  const changeKind = (value: GoalKind) => {
    setKind(value);
    // O valor de um tipo nao faz sentido no outro: 30 minutos viraria 30
    // palavras. Reposiciona no meio da faixa nova.
    const { min, max } = GOAL_LIMITS[value];
    setTarget(Math.round((min + max) / 6 / STEP[value]) * STEP[value]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiSend("/api/metas", "PUT", { kind, target });
      goal.reload();
      setEditing(false);
      notify("Meta salva.", "success");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Falha ao salvar a meta.", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await apiSend("/api/metas", "DELETE");
      goal.reload();
      setEditing(false);
      notify("Meta removida.", "success");
    } catch {
      notify("Falha ao remover a meta.", "error");
    } finally {
      setSaving(false);
    }
  };

  const limits = GOAL_LIMITS[kind];

  return (
    <>
      <Card className="space-y-4 p-5">
        <SectionTitle
          action={
            <button
              type="button"
              onClick={openEditor}
              className="min-h-11 text-sm font-medium text-accent"
            >
              {status.defined ? "Alterar" : "Definir"}
            </button>
          }
        >
          Meta de hoje
        </SectionTitle>

        {status.defined ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <p className="tabular text-2xl font-semibold">
                {`${formatNumber(status.progress)} / ${formatNumber(status.target)}`}
                <span className="ml-1 text-base font-normal text-muted">{status.kind}</span>
              </p>
              {status.progress >= status.target ? (
                <span className="rounded-full bg-positive-soft px-2.5 py-1 text-sm font-medium text-positive">
                  Cumprida
                </span>
              ) : null}
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{
                  width: `${Math.min(100, (status.progress / status.target) * 100)}%`,
                }}
              />
            </div>

            <div className="flex items-center gap-2 text-sm text-muted">
              <SparkIcon className="size-4 text-accent" />
              {status.streak > 0
                ? `${status.streak} ${status.streak === 1 ? "dia seguido" : "dias seguidos"}${
                    status.pendingToday ? " · falta hoje" : ""
                  } · melhor: ${status.bestStreak}`
                : "Cumpra a meta hoje para comecar uma sequencia."}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">
            Defina quantos minutos ou palavras quer ler por dia e acompanhe a sequencia.
          </p>
        )}
      </Card>

      <Sheet open={editing} onClose={() => setEditing(false)} title="Meta diaria">
        <div className="space-y-5">
          <Segmented<GoalKind>
            label="Tipo de meta"
            value={kind}
            onChange={changeKind}
            options={KIND_OPTIONS}
          />

          <Slider
            label="Quanto por dia"
            display={`${formatNumber(target)} ${kind}`}
            min={limits.min}
            max={limits.max}
            step={STEP[kind]}
            value={target}
            onChange={setTarget}
          />

          <Button size="lg" full loading={saving} onClick={save}>
            Salvar meta
          </Button>

          {status.defined ? (
            <Button variant="ghost" full onClick={remove} disabled={saving}>
              Remover a meta de hoje
            </Button>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}
