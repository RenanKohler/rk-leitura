"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAuth, useSettings } from "@/components/providers";
import { ImportCard } from "@/components/import-card";
import { useResource } from "@/hooks/use-resource";
import { Card, EmptyState, LinkButton, SectionTitle, Skeleton } from "@/components/ui";
import { ForwardIcon, LibraryIcon, PlayIcon, SpeedIcon, SparkIcon, WordsIcon } from "@/components/icons";
import { estimatedMinutes, formatNumber } from "@/lib/reading";
import type { ContinueReading, DashboardStats, Paginated, TextSummary } from "@/lib/types";

export type Overview = { stats: DashboardStats; continueReading: ContinueReading | null };
export type RecentTexts = { texts: TextSummary[] } & Paginated;

export function DashboardClient({
  initialOverview,
  initialTexts,
}: {
  initialOverview: Overview;
  initialTexts: RecentTexts;
}) {
  const { user } = useAuth();
  const { settings } = useSettings();
  // Somas e a leitura em andamento vem prontas do servidor: a tela nao precisa
  // baixar o historico inteiro para calcular media e total.
  const overview = useResource<Overview>("/api/stats", initialOverview);
  const texts = useResource<RecentTexts>("/api/texts?perPage=5", initialTexts);

  const list = useMemo(() => texts.data?.texts ?? [], [texts.data]);
  const stats = overview.data?.stats;
  const inProgress = overview.data?.continueReading ?? null;
  const loading = texts.loading || overview.loading;

  const firstName = user?.name?.split(" ")[0] ?? "";

  return (
    <div className="space-y-6">
      <header className="animate-rise pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {firstName ? `Ola, ${firstName}` : "Ola"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {stats && stats.sessions > 0
            ? `${formatNumber(stats.wordsRead)} palavras lidas ate agora.`
            : "Importe um artigo e comece a ler."}
        </p>
      </header>

      {inProgress ? <ContinueCard text={inProgress} wpm={settings.baseWpm} /> : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<SpeedIcon className="size-5" />}
          label="Media"
          value={stats && stats.avgWpm > 0 ? `${stats.avgWpm}` : "--"}
          suffix="ppm"
          loading={loading}
        />
        <Stat
          icon={<WordsIcon className="size-5" />}
          label="Palavras"
          value={formatNumber(stats?.wordsRead ?? 0)}
          loading={loading}
        />
        <Stat
          icon={<SparkIcon className="size-5" />}
          label="Sessoes"
          value={`${stats?.sessions ?? 0}`}
          loading={loading}
        />
        <Stat
          icon={<LibraryIcon className="size-5" />}
          label="Textos"
          value={`${stats?.texts ?? 0}`}
          loading={loading}
        />
      </section>

      <ImportCard
        onImported={() => {
          texts.reload();
          overview.reload();
        }}
      />

      <section className="space-y-3">
        <SectionTitle
          action={
            list.length > 0 ? (
              <Link href="/textos" className="text-sm font-medium text-accent">
                Ver todos
              </Link>
            ) : null
          }
        >
          Adicionados recentemente
        </SectionTitle>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-20 w-full rounded-card" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <Card>
            <EmptyState
              icon={<LibraryIcon className="size-7" />}
              title="Biblioteca vazia"
              description="Cole o link de um artigo acima ou escreva seu proprio texto."
              action={<LinkButton href="/textos/novo">Adicionar texto</LinkButton>}
            />
          </Card>
        ) : (
          <ul className="space-y-2">
            {list.slice(0, 5).map((text, index) => (
              <TextRow key={text.id} text={text} wpm={settings.baseWpm} index={index} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ContinueCard({ text, wpm }: { text: ContinueReading; wpm: number }) {
  const percent = Math.round((text.progressIndex / Math.max(1, text.wordCount)) * 100);
  const remaining = estimatedMinutes(text.wordCount - text.progressIndex, wpm);

  return (
    <Link href={`/leitor/${text.id}`} className="block">
      <Card className="animate-rise overflow-hidden p-4">
        <div className="flex items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">
            <PlayIcon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-accent">Continuar</p>
            <p className="truncate font-medium">{text.title}</p>
            <p className="text-sm text-muted">
              {`${percent}% lido \u00b7 faltam ~${remaining} min`}
            </p>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
      </Card>
    </Link>
  );
}

function TextRow({ text, wpm, index }: { text: TextSummary; wpm: number; index: number }) {
  return (
    <li className="animate-rise" style={{ animationDelay: `${index * 40}ms` }}>
      <Link href={`/leitor/${text.id}`}>
        <Card className="flex items-center gap-3 p-4 transition-colors hover:border-border-strong">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{text.title}</p>
            <p className="mt-0.5 text-sm text-muted">
              {`${formatNumber(text.wordCount)} palavras \u00b7 ~${estimatedMinutes(text.wordCount, wpm)} min`}
            </p>
          </div>
          <ForwardIcon className="size-5 shrink-0 text-faint" />
        </Card>
      </Link>
    </li>
  );
}

function Stat({
  icon,
  label,
  value,
  suffix,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
  loading: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-faint">{icon}</div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-16" />
      ) : (
        <p className="tabular mt-2 text-2xl font-semibold tracking-tight">
          {value}
          {suffix ? <span className="ml-1 text-sm font-normal text-muted">{suffix}</span> : null}
        </p>
      )}
      <p className="mt-0.5 text-sm text-muted">{label}</p>
    </Card>
  );
}
