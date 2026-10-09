"use client";

import { useState } from "react";
import Link from "next/link";
import { apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Button, Card, EmptyState, LinkButton } from "@/components/ui";
import { BackIcon, CheckIcon, CloseIcon, WordsIcon } from "@/components/icons";
import { GradeButtons } from "@/components/grade-buttons";
import { formatDate } from "@/lib/reading";
import type { ReviewGrade } from "@/lib/vocabulary";
import { definitionChoices, markWord } from "@/lib/word-choices";
import type { ReviewCard, ReviewSession } from "@/lib/types";

/**
 * Revisao das palavras salvas (US-64).
 *
 * Uma palavra por vez, com a frase em que apareceu. A definicao so aparece
 * depois do toque em "Mostrar": ver a resposta antes de tentar lembrar
 * transformaria a revisao em releitura.
 *
 * Quatro respostas (PROD-7): Errei volta amanha; Dificil, Bom e Facil
 * multiplicam o intervalo atual por 1,2, 2,5 e 4. Palavra guardada sem
 * definicao (PROD-6) mostra o contexto e "sem definicao", com a opcao de
 * buscar de novo.
 *
 * Palavra com alternativas guardadas (US-151) vira multipla escolha: a frase
 * de origem com a palavra marcada e quatro definicoes em ordem aleatoria.
 * Errar destaca a correta e registra "Errei", que devolve a palavra ao
 * intervalo inicial; acertar abre as respostas de sempre.
 */
export function ReviewClient({ initial }: { initial: ReviewSession }) {
  const notify = useToast();
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remembered, setRemembered] = useState(0);
  // Definicoes buscadas durante a sessao, por id: o cartao ja mostrado nao
  // volta do servidor.
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const [fetching, setFetching] = useState(false);
  // Alternativa escolhida na multipla escolha (US-151).
  const [picked, setPicked] = useState<number | null>(null);

  const cards = initial.cards;
  const card = cards[position];
  const done = cards.length > 0 && position >= cards.length;

  const refetch = async (id: string) => {
    setFetching(true);
    try {
      const data = await apiSend<{ entry: { definition: string } }>(
        `/api/palavras/${id}/definicao`,
        "POST"
      );
      setFetched((current) => ({ ...current, [id]: data.entry.definition }));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Não consegui buscar a definição.", "error");
    } finally {
      setFetching(false);
    }
  };

  /** Registra a resposta; devolve se deu certo. */
  const record = async (grade: ReviewGrade): Promise<boolean> => {
    if (!card) return false;
    setBusy(true);
    try {
      await apiSend("/api/palavras/revisao", "POST", { id: card.id, grade });
      if (grade !== "errei") setRemembered((count) => count + 1);
      return true;
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Não consegui registrar.", "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const advance = () => {
    setRevealed(false);
    setPicked(null);
    setPosition((current) => current + 1);
  };

  const answer = async (grade: ReviewGrade) => {
    if (!card || busy) return;
    if (await record(grade)) advance();
  };

  const choices = card ? definitionChoices(card.definition, card.distractors, card.id) : null;

  /** Escolha na multipla escolha: errar ja registra "Errei". */
  const pick = async (index: number) => {
    if (!choices || picked !== null || busy) return;
    setPicked(index);
    if (index !== choices.answer && !(await record("errei"))) setPicked(null);
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
              description="Durante a leitura, toque e segure em uma palavra para ver o significado. Ela entra na revisão no dia seguinte."
              action={<LinkButton href="/textos">Ir para a biblioteca</LinkButton>}
            />
          ) : (
            <EmptyState
              icon={<CheckIcon className="size-7" />}
              title="Nenhuma palavra para revisar hoje"
              description={
                initial.nextReviewOn
                  ? `A próxima revisão é em ${formatDate(`${initial.nextReviewOn}T12:00:00`)}.`
                  : "Todas as palavras estão marcadas como aprendidas."
              }
              action={<LinkButton href="/palavras">Ver palavras salvas</LinkButton>}
            />
          )}
        </Card>
      ) : done ? (
        <Card>
          <EmptyState
            icon={<CheckIcon className="size-7" />}
            title="Revisão concluída"
            description={`Você lembrou ${remembered} de ${cards.length}. As que você errou voltam amanhã.`}
            action={<LinkButton href="/palavras">Ver palavras salvas</LinkButton>}
          />
        </Card>
      ) : card && choices ? (
        <Card className="space-y-5 p-5">
          <div>
            <p className="text-2xl font-semibold tracking-tight">{card.word}</p>
            {card.context ? <MarkedContext card={card} /> : null}
            {card.textTitle ? (
              <p className="mt-2 text-xs text-faint">em {card.textTitle}</p>
            ) : null}
          </div>

          <div className="space-y-2" data-testid="alternativas">
            <p className="text-sm font-medium text-muted">Qual é o sentido aqui?</p>
            {choices.choices.map((choice, index) => {
              const answered = picked !== null;
              const correct = answered && index === choices.answer;
              const wrong = answered && index === picked && index !== choices.answer;
              return (
                <button
                  key={index}
                  type="button"
                  disabled={answered || busy}
                  aria-pressed={picked === index}
                  data-correct={correct ? "true" : undefined}
                  onClick={() => void pick(index)}
                  className={`flex min-h-11 w-full items-start gap-2 rounded-2xl border px-3 py-2 text-left text-sm transition-colors ${
                    correct
                      ? "border-positive bg-positive-soft text-positive"
                      : wrong
                        ? "border-danger bg-danger-soft text-danger"
                        : "border-border"
                  } ${answered && !correct && !wrong ? "opacity-60" : ""}`}
                >
                  {correct ? <CheckIcon className="mt-0.5 size-4 shrink-0" /> : null}
                  {wrong ? <CloseIcon className="mt-0.5 size-4 shrink-0" /> : null}
                  <span>{choice}</span>
                </button>
              );
            })}
          </div>

          {picked !== null ? (
            <div className="space-y-2 border-t border-border pt-4" aria-live="polite">
              <p className="font-medium">
                {card.base}
                {card.kind ? <span className="text-sm text-faint"> · {card.kind}</span> : null}
              </p>
              {card.translation ? <p className="font-medium">{card.translation}</p> : null}
              {picked === choices.answer ? (
                <p className="text-sm text-positive">Certa. Quanto custou lembrar?</p>
              ) : (
                <p className="text-sm text-danger" data-testid="errou">
                  Não era essa. A palavra volta amanhã.
                </p>
              )}
            </div>
          ) : null}

          {picked === null ? null : picked === choices.answer ? (
            <GradeButtons interval={card.interval} busy={busy} onGrade={(grade) => void answer(grade)} />
          ) : (
            <Button size="lg" full disabled={busy} onClick={advance}>
              Continuar
            </Button>
          )}
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
              {(fetched[card.id] ?? card.definition).trim() ? (
                <p className="leading-relaxed">{fetched[card.id] ?? card.definition}</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm italic text-faint">sem definição</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={fetching}
                    onClick={() => void refetch(card.id)}
                  >
                    Buscar definição
                  </Button>
                </div>
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

/** Frase de origem com a palavra marcada (US-151). */
function MarkedContext({ card }: { card: ReviewCard }) {
  const context = card.context ?? "";
  const parts = markWord(context, card.word);
  return (
    <p className="mt-2 leading-relaxed text-muted" data-testid="frase-origem">
      &ldquo;
      {parts ? (
        <>
          {parts.before}
          <mark className="rounded bg-accent-soft px-0.5 font-medium text-ink">{parts.match}</mark>
          {parts.after}
        </>
      ) : (
        context
      )}
      &rdquo;
    </p>
  );
}
