"use client";

import { useState } from "react";
import Link from "next/link";
import { apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Button, Card, EmptyState, LinkButton } from "@/components/ui";
import { BackIcon, CheckIcon, RestartIcon, WordsIcon } from "@/components/icons";
import { formatDate } from "@/lib/reading";
import type { ReviewSession } from "@/lib/types";

/**
 * Revisao das palavras salvas (US-64).
 *
 * Uma palavra por vez, com a frase em que apareceu. A definicao so aparece
 * depois do toque em "Mostrar": ver a resposta antes de tentar lembrar
 * transformaria a revisao em releitura.
 */
export function ReviewClient({ initial }: { initial: ReviewSession }) {
  const notify = useToast();
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remembered, setRemembered] = useState(0);

  const cards = initial.cards;
  const card = cards[position];
  const done = cards.length > 0 && position >= cards.length;

  const answer = async (value: boolean) => {
    if (!card || busy) return;
    setBusy(true);
    try {
      await apiSend("/api/palavras/revisao", "POST", { id: card.id, remembered: value });
      if (value) setRemembered((count) => count + 1);
      setRevealed(false);
      setPosition((current) => current + 1);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Nao consegui registrar.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-2 pt-2">
        <Link
          href="/palavras"
          aria-label="Voltar"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        >
          <BackIcon className="size-5" />
        </Link>
        <div className="flex-1 pt-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Revisar palavras</h1>
          {cards.length > 0 && !done ? (
            <p className="tabular mt-1 text-sm text-muted">
              {position + 1} de {cards.length}
              {initial.due > cards.length ? ` · ${initial.due} vencidas no total` : ""}
            </p>
          ) : null}
        </div>
      </header>

      {cards.length === 0 ? (
        <Card>
          {initial.totalWords === 0 ? (
            <EmptyState
              icon={<WordsIcon className="size-7" />}
              title="Nenhuma palavra salva"
              description="Durante a leitura, toque e segure em uma palavra para ver o significado. Ela entra na revisao no dia seguinte."
              action={<LinkButton href="/textos">Ir para a biblioteca</LinkButton>}
            />
          ) : (
            <EmptyState
              icon={<CheckIcon className="size-7" />}
              title="Nenhuma palavra para revisar hoje"
              description={
                initial.nextReviewOn
                  ? `A proxima revisao e em ${formatDate(`${initial.nextReviewOn}T12:00:00`)}.`
                  : "Todas as palavras estao marcadas como aprendidas."
              }
              action={<LinkButton href="/palavras">Ver palavras salvas</LinkButton>}
            />
          )}
        </Card>
      ) : done ? (
        <Card>
          <EmptyState
            icon={<CheckIcon className="size-7" />}
            title="Revisao concluida"
            description={`Voce lembrou ${remembered} de ${cards.length}. As que ficaram para tras voltam amanha.`}
            action={<LinkButton href="/palavras">Ver palavras salvas</LinkButton>}
          />
        </Card>
      ) : card ? (
        <Card className="space-y-5 p-5">
          <div>
            <p className="text-2xl font-semibold tracking-tight">{card.word}</p>
            {card.context ? (
              <p className="mt-2 leading-relaxed text-muted">&ldquo;{card.context}&rdquo;</p>
            ) : null}
            {card.textTitle ? (
              <p className="mt-2 text-xs text-faint">em {card.textTitle}</p>
            ) : null}
          </div>

          {revealed ? (
            <div className="space-y-2 border-t border-border pt-4" aria-live="polite">
              <p className="font-medium">
                {card.base}
                {card.kind ? <span className="text-sm text-faint"> · {card.kind}</span> : null}
              </p>
              {card.translation ? <p className="font-medium">{card.translation}</p> : null}
              <p className="leading-relaxed">{card.definition}</p>
            </div>
          ) : null}

          {revealed ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="lg" loading={busy} onClick={() => void answer(false)}>
                <RestartIcon className="size-5" />
                Nao lembrei
              </Button>
              <Button size="lg" loading={busy} onClick={() => void answer(true)}>
                <CheckIcon className="size-5" />
                Lembrei
              </Button>
            </div>
          ) : (
            <Button size="lg" full onClick={() => setRevealed(true)}>
              Mostrar
            </Button>
          )}
        </Card>
      ) : null}
    </div>
  );
}
