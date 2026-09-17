"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useResource } from "@/hooks/use-resource";
import { Card, EmptyState, LinkButton, Pagination, Skeleton } from "@/components/ui";
import { CheckIcon, HistoryIcon } from "@/components/icons";
import { formatDuration, formatNumber, formatRelativeDay } from "@/lib/reading";
import type { DashboardStats, Paginated, SessionSummary } from "@/lib/types";

export type SessionsPage = { sessions: SessionSummary[] } & Paginated;

export function HistoryClient({
  initialSessions,
  initialOverview,
}: {
  initialSessions: SessionsPage;
  initialOverview: { stats: DashboardStats };
}) {
  const [page, setPage] = useState(1);
  // A primeira pagina e os agregados ja vieram no HTML.
  const resource = useResource<SessionsPage>(
    `/api/reading-sessions?page=${page}`,
    page === 1 ? initialSessions : undefined
  );
  // O melhor ritmo e de toda a conta, nao apenas da pagina visivel.
  const overview = useResource<{ stats: DashboardStats }>("/api/stats", initialOverview);

  const sessions = useMemo(() => resource.data?.sessions ?? [], [resource.data]);
  const total = resource.data?.total ?? sessions.length;
  const pageCount = resource.data?.pageCount ?? 1;

  const grouped = useMemo(() => {
    const map = new Map<string, SessionSummary[]>();
    for (const session of sessions) {
      const key = formatRelativeDay(session.createdAt);
      const bucket = map.get(key);
      if (bucket) bucket.push(session);
      else map.set(key, [session]);
    }
    return [...map.entries()];
  }, [sessions]);

  const best = overview.data?.stats.bestWpm ?? 0;

  return (
    <div className="space-y-6">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Historico</h1>
        <p className="mt-1 text-sm text-muted">
          {resource.loading
            ? "Carregando"
            : sessions.length === 0
              ? "Nenhuma sessao registrada"
              : `${total} ${total === 1 ? "sessao" : "sessoes"} · melhor ritmo ${best} ppm`}
        </p>
      </header>

      {resource.loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24 w-full rounded-card" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HistoryIcon className="size-7" />}
            title="Sem historico ainda"
            description="Cada leitura concluida registra ritmo, palavras e tempo aqui."
            action={<LinkButton href="/textos">Ir para a biblioteca</LinkButton>}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([day, items]) => (
            <section key={day} className="space-y-2">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-faint">
                {day}
              </h2>
              <ul className="space-y-2">
                {items.map((session) => (
                  <li key={session.id}>
                    <Link href={`/leitor/${session.textId}`}>
                      <Card className="p-4 transition-colors hover:border-border-strong">
                        <div className="flex items-start gap-2">
                          <p className="min-w-0 flex-1 truncate font-medium">{session.textTitle}</p>
                          {session.completed ? (
                            <span
                              title="Concluido"
                              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-positive-soft text-positive"
                            >
                              <CheckIcon className="size-3.5" />
                            </span>
                          ) : null}
                        </div>

                        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                          <Metric label="ppm" value={`${session.wpm}`} highlight />
                          <Metric label="palavras" value={formatNumber(session.wordsRead)} />
                          <Metric label="tempo" value={formatDuration(session.durationMs)} />
                        </dl>
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <Pagination
            page={resource.data?.page ?? page}
            pageCount={pageCount}
            busy={resource.loading}
            onChange={(next) => {
              setPage(next);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl bg-surface-2 py-2">
      <dd className={`tabular text-lg font-semibold ${highlight ? "text-accent" : ""}`}>{value}</dd>
      <dt className="text-xs text-muted">{label}</dt>
    </div>
  );
}
