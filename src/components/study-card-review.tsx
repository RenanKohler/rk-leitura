"use client";

import { useState } from "react";
import Link from "next/link";
import { apiSend } from "@/lib/client";
import { Alert, Button, Card } from "@/components/ui";
import { GradeButtons } from "@/components/grade-buttons";
import { STUDY_CARD_KIND_LABELS, isStudyCardKind } from "@/lib/study-cards";
import type { ReviewGrade } from "@/lib/vocabulary";
import type { StudyReviewCard } from "@/lib/study-review-queries";

/**
 * Um cartao de estudo na revisao (US-156, US-168), usado na revisao do texto
 * e na revisao do dia.
 *
 * A frente sozinha; "Mostrar resposta" abre o verso, a analogia guardada, o
 * trecho de origem com "Ver no texto" e as quatro notas. Depois de "Errei" o
 * cartao fica na tela com "Explicar de outro jeito": a analogia pode ser
 * guardada no cartao. Qualquer falha da IA, inclusive a cota, aparece como
 * aviso e "Continuar" segue a revisao.
 */
export function StudyCardReview({
  card,
  onDone,
  onError,
}: {
  card: StudyReviewCard;
  /** Nota gravada e o leitor pronto para o proximo item. */
  onDone: (grade: ReviewGrade) => void;
  onError: (message: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [missed, setMissed] = useState(false);
  const [analogy, setAnalogy] = useState<string | null>(null);
  const [saved, setSaved] = useState(card.analogy);
  const [asking, setAsking] = useState(false);
  const [aiError, setAiError] = useState("");

  const grade = async (value: ReviewGrade) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiSend(`/api/cartoes/${card.id}/revisao`, "POST", { grade: value });
      if (value === "errei") setMissed(true);
      else onDone(value);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Não consegui registrar.");
    } finally {
      setBusy(false);
    }
  };

  const explain = async () => {
    setAsking(true);
    setAiError("");
    try {
      const data = await apiSend<{ analogy: string }>(`/api/cartoes/${card.id}/analogia`, "POST");
      setAnalogy(data.analogy);
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : "Não consegui explicar agora.");
    } finally {
      setAsking(false);
    }
  };

  const keep = async () => {
    if (!analogy) return;
    setBusy(true);
    try {
      await apiSend(`/api/cartoes/${card.id}/analogia`, "PUT", { analogy });
      setSaved(analogy);
      setAnalogy(null);
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : "Não consegui guardar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="cartao-estudo">
    <Card className="space-y-5 p-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-faint">
          {isStudyCardKind(card.kind) ? STUDY_CARD_KIND_LABELS[card.kind] : "Cartão"} · {card.textTitle}
        </p>
        <p className="mt-1 text-lg font-medium leading-relaxed" data-testid="cartao-frente">
          {card.front}
        </p>
      </div>

      {revealed ? (
        <div className="space-y-4 border-t border-border pt-4" aria-live="polite">
          <p className="leading-relaxed" data-testid="cartao-verso">
            {card.back}
          </p>
          {saved ? (
            <p className="text-sm text-muted" data-testid="cartao-analogia">
              <span className="font-medium">Analogia: </span>
              {saved}
            </p>
          ) : null}
          {card.source ? (
            <blockquote className="border-l-2 border-accent pl-3 text-sm leading-relaxed text-muted">
              {card.source}
            </blockquote>
          ) : null}
          <Link
            href={`/leitor/${card.textId}?de=${card.sourceStart}`}
            className="inline-flex min-h-11 items-center text-sm font-medium text-accent"
          >
            Ver no texto
          </Link>
        </div>
      ) : null}

      {missed ? (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm text-danger">O cartão volta amanhã.</p>
          {aiError ? <Alert>{aiError}</Alert> : null}
          {analogy ? (
            <div className="space-y-2 rounded-2xl bg-surface-2 p-3" data-testid="analogia-nova">
              <p className="leading-relaxed">{analogy}</p>
              <Button variant="secondary" size="sm" loading={busy} onClick={() => void keep()}>
                Guardar no cartão
              </Button>
            </div>
          ) : saved && saved !== card.analogy ? (
            <p className="text-sm text-positive">Analogia guardada no cartão.</p>
          ) : (
            <Button variant="secondary" full loading={asking} onClick={() => void explain()}>
              Explicar de outro jeito
            </Button>
          )}
          <Button size="lg" full disabled={busy} onClick={() => onDone("errei")}>
            Continuar
          </Button>
        </div>
      ) : revealed ? (
        <GradeButtons interval={card.interval} busy={busy} onGrade={(value) => void grade(value)} />
      ) : (
        <Button size="lg" full onClick={() => setRevealed(true)}>
          Mostrar resposta
        </Button>
      )}
    </Card>
    </div>
  );
}
