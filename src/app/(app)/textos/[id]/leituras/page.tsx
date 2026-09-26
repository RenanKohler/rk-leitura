import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadTextHistory } from "@/lib/queries";
import { textHistory } from "@/lib/calendar";
import { estimatedMinutes, formatClock, formatNumber } from "@/lib/reading";
import { Card, EmptyState } from "@/components/ui";
import { BackIcon, HistoryIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" });
const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Quanto tempo e em quantas sessoes um texto foi lido (US-101). */
export default async function TextHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const loaded = UUID_PATTERN.test(id) ? await loadTextHistory(session.id, id) : null;
  if (!loaded) notFound();

  const { text, rows, pace } = loaded;
  const history = textHistory(rows);
  const concluded = text.wordCount > 0 && text.progressIndex >= text.wordCount;
  const estimateMs = estimatedMinutes(text.wordCount, pace.wpm) * 60_000;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <div className="flex items-start gap-2">
        <Link
          href={`/leitor/${text.id}`}
          aria-label="Voltar ao texto"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        >
          <BackIcon className="size-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Leituras</h1>
          <p className="truncate text-sm text-muted">{text.title}</p>
        </div>
      </div>

      {history.sessions === 0 ? (
        <Card>
          <EmptyState
            icon={<HistoryIcon className="size-7" />}
            title="Nenhuma sessao registrada"
            description="Sessoes com menos de 10 palavras lidas nao sao gravadas."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3" data-testid="resumo-texto">
            <Stat label="Tempo total" value={formatClock(history.totalMs)} />
            <Stat label="Sessoes" value={formatNumber(history.sessions)} />
            <Stat label="Ritmo medio" value={`${formatNumber(history.wpm)} ppm`} />
            <Stat
              label="Primeira e ultima"
              value={`${DATE.format(new Date(history.firstAt!))} - ${DATE.format(new Date(history.lastAt!))}`}
              small
            />
          </div>

          {concluded ? (
            <Card className="p-4 text-sm">
              <p>
                Leitura concluida em <strong>{formatClock(history.totalMs)}</strong>. Pelo seu ritmo
                atual ({formatNumber(pace.wpm)} ppm), a previsao para este texto seria de{" "}
                <strong>{formatClock(estimateMs)}</strong>.
              </p>
            </Card>
          ) : null}

          <Card as="section" className="p-4">
            <h2 className="mb-2 text-base font-semibold">Sessoes</h2>
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.createdAt.toISOString()} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{DATE_TIME.format(row.createdAt)}</span>
                  <span className="tabular text-muted">
                    {formatClock(row.durationMs)} &middot; {formatNumber(row.wordsRead)} palavras &middot; {row.wpm} ppm
                    {row.completed ? " · concluiu" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <Card className="p-4">
      <p className={`tabular font-semibold ${small ? "text-sm" : "text-xl"}`}>{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </Card>
  );
}
