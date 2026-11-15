"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAuth, useSettings } from "@/components/providers";
import { useResource } from "@/hooks/use-resource";
import { Card, EmptyState, LinkButton, SectionTitle, Skeleton } from "@/components/ui";
import { ForwardIcon, LibraryIcon, PlayIcon, SpeedIcon, SparkIcon, WordsIcon } from "@/components/icons";
import { estimatedMinutes, formatNumber } from "@/lib/reading";
import { itemsLabel } from "@/lib/daily-review";
import { GoalCard } from "@/components/goal-card";
import { FreeTimeCard } from "@/components/free-time-card";
import { PlacementTest } from "@/components/placement-test";
import { apiSend } from "@/lib/client";
import { WeeklySummaryCard } from "@/components/weekly-summary-card";
import type {
  ContinueReading,
  DashboardStats,
  GoalStatus,
  Paginated,
  TextSummary,
  WeeklySummary,
} from "@/lib/types";

export type Overview = { stats: DashboardStats; continueReading: ContinueReading | null };
export type RecentTexts = { texts: TextSummary[] } & Paginated;

/**
 * Inicio.
 *
 * Mais curto desde a US-228: a tela tinha quase tres alturas de celular e
 * dois blocos repetiam o que ja estava a um toque. O cartao "Revisar
 * destaques" contava itens que a Revisao do dia ja conta, e "Importar de um
 * link" fazia o mesmo que o botao "+" da barra, que abre a tela de novo
 * texto com o link como primeira opcao.
 */
export function DashboardClient({
  initialOverview,
  initialTexts,
  goal,
  weekly,
  offerPlacement,
  pace,
  dailyReview = 0,
}: {
  initialOverview: Overview;
  initialTexts: RecentTexts;
  goal: GoalStatus;
  weekly: WeeklySummary | null;
  offerPlacement: boolean;
  pace: { wpm: number; fromSettings: boolean };
  /** Itens da revisao do dia (US-161): palavras, destaques, cartoes e questionarios. */
  dailyReview?: number;
}) {
  const { user } = useAuth();
  const { settings } = useSettings();
  // Somas e a leitura em andamento vem prontas do servidor: a tela nao precisa
  // baixar o historico inteiro para calcular media e total.
  const overview = useResource<Overview>("/api/stats", initialOverview);
  const texts = useResource<RecentTexts>("/api/texts/recentes?perPage=5", initialTexts);

  const list = useMemo(() => texts.data?.texts ?? [], [texts.data]);
  const stats = overview.data?.stats;
  const inProgress = overview.data?.continueReading ?? null;
  const loading = texts.loading || overview.loading;

  const firstName = user?.name?.split(" ")[0] ?? "";
  const [dismissed, setDismissed] = useState(false);
  const [freeMinutes, setFreeMinutes] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      <header className="animate-rise pt-2">
        <h1 className="text-headline-small">
          {firstName ? `Olá, ${firstName}` : "Olá"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {stats && stats.sessions > 0
            ? `${formatNumber(stats.wordsRead)} palavras lidas até agora.`
            : "Importe um artigo e comece a ler."}
        </p>
      </header>

      {offerPlacement && !dismissed ? (
        <PlacementTest
          onApplied={() => setDismissed(true)}
          onSkip={() => {
            setDismissed(true);
            // Pular grava a data de "ja oferecido": a tela inicial nao insiste
            // a cada visita, e o teste continua disponivel em Treino.
            void apiSend("/api/teste-de-leitura", "DELETE").catch(() => undefined);
          }}
        />
      ) : null}

      {weekly ? <WeeklySummaryCard summary={weekly} /> : null}

      <GoalCard
        initial={goal}
        paceWpm={pace.wpm}
        onSuggest={(minutes) => {
          setFreeMinutes(minutes);
          document.getElementById("tempo-livre")?.scrollIntoView({ behavior: "smooth" });
        }}
      />

      <FreeTimeCard minutes={freeMinutes} onChoose={setFreeMinutes} />

      {inProgress ? <ContinueCard text={inProgress} wpm={settings.baseWpm} /> : null}

      {dailyReview > 0 ? <DailyReviewCard due={dailyReview} /> : null}

      <SectionTitle
        action={
          <Link href="/estatisticas" className="min-h-11 text-sm font-medium text-accent">
            Ver evolução
          </Link>
        }
      >
        Números
      </SectionTitle>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<SpeedIcon className="size-5" />}
          label="Média"
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
          label="Sessões"
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
              // O campo de link saiu daqui (US-228): quem importa e o botao
              // "+", na barra de baixo no celular e na lateral no desktop.
              description="Use o botão + para importar um artigo por link ou escrever seu próprio texto."
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
            <p className="text-xs font-medium uppercase tracking-[0.5px] text-accent">Continuar</p>
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
        <p className="tabular mt-2 text-headline-small">
          {value}
          {suffix ? <span className="ml-1 text-sm font-normal text-muted">{suffix}</span> : null}
        </p>
      )}
      <p className="mt-0.5 text-sm text-muted">{label}</p>
    </Card>
  );
}

/**
 * Atalho para a revisao do dia (US-161). E o unico cartao de revisao do
 * Inicio (US-228): os destaques vencidos ja entram na conta dele.
 */
function DailyReviewCard({ due }: { due: number }) {
  return (
    <Link href="/revisar" className="block" data-testid="cartao-revisao-do-dia">
      <Card className="flex items-center gap-3 p-4 transition-colors hover:border-border-strong">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <WordsIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{`Revisão do dia: ${itemsLabel(due)}`}</p>
          <p className="text-sm text-muted">Palavras, destaques, cartões e questionários vencidos</p>
        </div>
        <ForwardIcon className="size-5 text-faint" />
      </Card>
    </Link>
  );
}
