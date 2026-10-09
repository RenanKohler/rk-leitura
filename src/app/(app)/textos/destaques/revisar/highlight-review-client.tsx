"use client";

import { useState } from "react";
import Link from "next/link";
import { apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Button, Card, EmptyState, LinkButton, Segmented } from "@/components/ui";
import { BackIcon, CheckIcon, LibraryIcon } from "@/components/icons";
import { GradeButtons } from "@/components/grade-buttons";
import type { ReviewGrade } from "@/lib/vocabulary";
import { bareWord } from "@/lib/cloze";
import type { HighlightReviewCard, HighlightReviewSession } from "@/lib/types";

type Mode = "lacuna" | "trecho";

/**
 * Revisao espacada dos destaques (PROD-4).
 *
 * Mesmo desenho da revisao de palavras: um cartao por vez, a resposta so
 * depois do toque, e as quatro respostas com a mesma regra de agendamento.
 * No modo "lacuna" a palavra de maior peso do trecho some - reconhecer um
 * trecho relido e facil, lembrar a palavra que faltava e o que mostra se ele
 * ficou. No modo "trecho" o cartao mostra o trecho e pede para lembrar a nota
 * ou o porque da marcacao.
 */
export function HighlightReviewClient({ initial }: { initial: HighlightReviewSession }) {
  const notify = useToast();
  const [mode, setMode] = useState<Mode>("lacuna");
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remembered, setRemembered] = useState(0);

  const cards = initial.cards;
  const card = cards[position];
  const done = cards.length > 0 && position >= cards.length;

  const answer = async (grade: ReviewGrade) => {
    if (!card || busy) return;
    setBusy(true);
    try {
      await apiSend("/api/destaques/revisao", "POST", { id: card.id, grade });
      if (grade !== "errei") setRemembered((count) => count + 1);
      setRevealed(false);
      setPosition((current) => current + 1);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Não consegui registrar.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-2 pt-2">
        <Link
          href="/textos"
          aria-label="Voltar"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        >
          <BackIcon className="size-5" />
        </Link>
        <div className="flex-1 pt-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Revisar destaques</h1>
          {cards.length > 0 && !done ? (
            <p className="tabular mt-1 text-sm text-muted">
              {position + 1} de {cards.length}
              {initial.due > cards.length ? ` · ${initial.due} vencidos no total` : ""}
            </p>
          ) : null}
        </div>
      </header>

      {cards.length > 0 && !done ? (
        <Segmented<Mode>
          label="Modo da revisão"
          value={mode}
          onChange={(value) => {
            setMode(value);
            setRevealed(false);
          }}
          options={[
            { value: "lacuna", label: "Lacuna" },
            { value: "trecho", label: "Trecho" },
          ]}
        />
      ) : null}

      {cards.length === 0 ? (
        <Card>
          {initial.totalHighlights === 0 ? (
            <EmptyState
              icon={<LibraryIcon className="size-7" />}
              title="Nenhum destaque ainda"
              description="Durante a leitura, marque os trechos que valem a pena. Eles entram na revisão no dia seguinte."
              action={<LinkButton href="/textos">Ir para a biblioteca</LinkButton>}
            />
          ) : (
            <EmptyState
              icon={<CheckIcon className="size-7" />}
              title="Nenhum destaque para revisar hoje"
              description="Os próximos voltam conforme o intervalo de cada um."
              action={<LinkButton href="/textos">Ir para a biblioteca</LinkButton>}
            />
          )}
        </Card>
      ) : done ? (
        <Card>
          <EmptyState
            icon={<CheckIcon className="size-7" />}
            title="Revisão concluída"
            description={`Você lembrou ${remembered} de ${cards.length}. Os que você errou voltam amanhã.`}
            action={<LinkButton href="/textos">Ir para a biblioteca</LinkButton>}
          />
        </Card>
      ) : card ? (
        <Card className="space-y-5 p-5">
          <Excerpt card={card} hideWord={mode === "lacuna" && !revealed} />
          <p className="text-xs text-faint">
            em{" "}
            <Link href={`/leitor/${card.textId}?de=${card.start}`} className="text-muted underline">
              {card.textTitle}
            </Link>
          </p>

          {revealed ? (
            <div className="space-y-2 border-t border-border pt-4" aria-live="polite">
              {card.note ? (
                <p className="leading-relaxed">
                  <span className="text-sm text-muted">Sua nota: </span>
                  {card.note}
                </p>
              ) : (
                <p className="text-sm text-faint">Sem nota neste destaque.</p>
              )}
            </div>
          ) : null}

          {revealed ? (
            <GradeButtons interval={card.interval} busy={busy} onGrade={(grade) => void answer(grade)} />
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

/** O trecho, com a palavra de maior peso escondida enquanto for lacuna. */
function Excerpt({ card, hideWord }: { card: HighlightReviewCard; hideWord: boolean }) {
  const blank = hideWord ? card.blank : null;
  return (
    <blockquote className="border-l-2 border-accent pl-3 text-lg leading-relaxed" data-testid="destaque-trecho">
      {card.words.map((word, index) => (
        <span key={index}>
          {index > 0 ? " " : ""}
          {index === blank ? <Blank token={word} /> : word}
        </span>
      ))}
    </blockquote>
  );
}

/** Lacuna no lugar da palavra, mantendo a pontuacao grudada nela. */
function Blank({ token }: { token: string }) {
  const bare = bareWord(token);
  const at = token.indexOf(bare);
  return (
    <>
      {token.slice(0, at)}
      <span className="inline-block min-w-16 border-b-2 border-accent align-baseline" data-testid="lacuna">
        <span className="sr-only">palavra escondida</span>
      </span>
      {token.slice(at + bare.length)}
    </>
  );
}
