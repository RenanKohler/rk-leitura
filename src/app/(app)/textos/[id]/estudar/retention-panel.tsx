import { getSession } from "@/lib/auth";
import { Card, LinkButton, SectionTitle } from "@/components/ui";
import { loadTextRetention } from "@/lib/study-review-queries";
import { CARD_RETENTION_DAYS, MATURE_INTERVAL_DAYS } from "@/lib/study-retention";
import type { StudyProps } from "./study-props";

/**
 * Retencao e conhecimento previo do texto (US-162), com o atalho para a
 * revisao dos cartoes (US-156).
 *
 * Componente de servidor: os numeros saem do banco na abertura de "Estudar",
 * sem rota propria. O conhecimento previo (US-170) fica ao lado e fora da
 * retencao: o teste nao e revisao.
 */
export async function RetentionPanel(props: StudyProps) {
  const session = await getSession();
  if (!session) return null;

  const { retention, pretest, due } = await loadTextRetention(session.id, {
    id: props.textId,
    progressIndex: props.progressIndex,
    wordCount: props.wordCount,
  });

  return (
    <Card as="section" className="space-y-4 p-5">
      <div data-testid="retencao">
        <SectionTitle>Retenção</SectionTitle>
        {retention.measured ? (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="tabular text-2xl font-semibold">{retention.percent}%</p>
              <p className="text-sm text-muted">
                de acertos nos últimos {CARD_RETENTION_DAYS} dias ({retention.reviews} revisões)
              </p>
            </div>
            <div>
              <p className="tabular text-2xl font-semibold">{retention.mature}</p>
              <p className="text-sm text-muted">
                {retention.mature === 1 ? "cartão maduro" : "cartões maduros"} ({MATURE_INTERVAL_DAYS}{" "}
                dias ou mais)
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">Poucas revisões para medir.</p>
        )}
        {pretest !== null ? (
          <p className="mt-3 text-sm" data-testid="conhecimento-previo">
            Conhecimento prévio: <strong className="tabular">{pretest}%</strong>
          </p>
        ) : null}
      </div>

      <LinkButton
        href={`/textos/${props.textId}/estudar/revisar`}
        variant={due > 0 ? "primary" : "secondary"}
        full
      >
        {`Revisar cartões (${due})`}
      </LinkButton>
    </Card>
  );
}
