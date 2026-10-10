"use client";

import { useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/providers";
import { Card, EmptyState, LinkButton } from "@/components/ui";
import { BackIcon, CheckIcon } from "@/components/icons";
import { StudyCardReview } from "@/components/study-card-review";
import { formatDate } from "@/lib/reading";
import type { CardReviewSession } from "@/lib/study-review-queries";

/**
 * Revisao dos cartoes de estudo de um texto (US-156). So entram cartoes de
 * trechos ja lidos e vencidos hoje; a regra fica em `lib/study-cards.ts`.
 */
export function CardReviewClient({ initial }: { initial: CardReviewSession }) {
  const notify = useToast();
  const [position, setPosition] = useState(0);
  const [remembered, setRemembered] = useState(0);

  const cards = initial.cards;
  const card = cards[position];
  const done = cards.length > 0 && position >= cards.length;
  const back = `/textos/${initial.textId}/estudar`;

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-2 pt-2">
        <Link
          href={back}
          aria-label="Voltar"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        >
          <BackIcon className="size-5" />
        </Link>
        <div className="min-w-0 flex-1 pt-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Revisar cartões</h1>
          <p className="truncate text-sm text-muted">
            {cards.length > 0 && !done ? `${position + 1} de ${cards.length} · ` : ""}
            {initial.title}
          </p>
        </div>
      </header>

      {cards.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckIcon className="size-7" />}
            title="Nenhum cartão para hoje."
            description={
              initial.nextReviewOn
                ? `A próxima revisão é em ${formatDate(`${initial.nextReviewOn}T12:00:00`)}.`
                : initial.readCards === 0
                  ? "Os cartões aparecem aqui conforme você lê os trechos de onde saíram."
                  : "Nenhuma revisão agendada."
            }
            action={<LinkButton href={back}>Voltar para Estudar</LinkButton>}
          />
        </Card>
      ) : done ? (
        <Card>
          <EmptyState
            icon={<CheckIcon className="size-7" />}
            title="Revisão concluída"
            description={`Você lembrou ${remembered} de ${cards.length}. Os que você errou voltam amanhã.`}
            action={<LinkButton href={back}>Voltar para Estudar</LinkButton>}
          />
        </Card>
      ) : card ? (
        <StudyCardReview
          key={card.id}
          card={card}
          onError={(message) => notify(message, "error")}
          onDone={(grade) => {
            if (grade !== "errei") setRemembered((count) => count + 1);
            setPosition((current) => current + 1);
          }}
        />
      ) : null}
    </div>
  );
}
