import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadOverview, loadReview, loadTraining } from "@/lib/queries";
import { formatNumber } from "@/lib/reading";
import { Card } from "@/components/ui";
import {
  ChartIcon,
  ChevronIcon,
  HistoryIcon,
  SettingsIcon,
  SpeedIcon,
  WordsIcon,
} from "@/components/icons";

export const dynamic = "force-dynamic";

export const metadata = { title: "Voce" };

/**
 * Hub pessoal (APP-6): tudo o que e sobre o progresso de quem le.
 *
 * Estatisticas, Palavras e Treino so eram alcancaveis por Ajustes, misturados
 * com preferencias. Aqui cada destino traz o numero que convida a abrir -
 * revisoes vencidas, o dia do treino - para a tela nao ser so uma lista de
 * links.
 */
export default async function YouPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [review, training, overview] = await Promise.all([
    loadReview(session.id),
    loadTraining(session.id),
    loadOverview(session.id),
  ]);

  const stats = overview.stats;
  const trainingStatus = !training
    ? "Teste de velocidade e programas de 14 ou 30 dias"
    : training.finished
      ? "Programa concluido"
      : `Dia ${training.currentDay} de ${training.length}${training.doneToday ? " · feito hoje" : " · pendente hoje"}`;

  return (
    <div className="space-y-6">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Voce</h1>
        <p className="mt-1 text-sm text-muted">
          {stats.sessions > 0
            ? `${formatNumber(stats.wordsRead)} palavras em ${stats.sessions} ${stats.sessions === 1 ? "sessao" : "sessoes"}.`
            : "Seu progresso aparece aqui depois da primeira leitura."}
        </p>
      </header>

      <nav aria-label="Seu progresso">
        <ul className="space-y-2">
          <Destination
            href="/estatisticas"
            icon={<ChartIcon className="size-5" />}
            title="Estatisticas"
            detail={
              stats.avgWpm > 0
                ? `Media de ${stats.avgWpm} ppm · calendario do ano`
                : "Evolucao da velocidade e calendario do ano"
            }
          />
          <Destination
            href="/historico"
            icon={<HistoryIcon className="size-5" />}
            title="Historico"
            detail="Todas as sessoes de leitura"
          />
          <Destination
            href={review.due > 0 ? "/palavras/revisar" : "/palavras"}
            icon={<WordsIcon className="size-5" />}
            title="Palavras e revisao"
            detail={
              review.due > 0
                ? `${review.due} ${review.due === 1 ? "revisao pendente" : "revisoes pendentes"}`
                : review.totalWords > 0
                  ? `${review.totalWords} ${review.totalWords === 1 ? "palavra salva" : "palavras salvas"} · nada para revisar hoje`
                  : "Toque e segure numa palavra durante a leitura para salvar"
            }
            badge={review.due > 0 ? `${review.due}` : undefined}
          />
          <Destination
            href="/treino"
            icon={<SpeedIcon className="size-5" />}
            title="Treino"
            detail={trainingStatus}
          />
          <Destination
            href="/ajustes"
            icon={<SettingsIcon className="size-5" />}
            title="Ajustes"
            detail="Leitura, aparencia, conta e dados"
          />
        </ul>
      </nav>
    </div>
  );
}

function Destination({
  href,
  icon,
  title,
  detail,
  badge,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  detail: string;
  badge?: string;
}) {
  return (
    <li>
      <Link href={href} className="block">
        <Card className="flex min-h-16 items-center gap-3 p-4 transition-colors hover:border-border-strong">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            {icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{title}</span>
            <span className="block text-sm text-muted">{detail}</span>
          </span>
          {badge ? (
            <span className="tabular rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-ink">
              {badge}
            </span>
          ) : null}
          <ChevronIcon className="size-5 shrink-0 -rotate-90 text-faint" />
        </Card>
      </Link>
    </li>
  );
}
