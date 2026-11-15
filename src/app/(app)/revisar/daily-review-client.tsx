"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiError, apiGet, apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Alert, Button, Card, EmptyState, LinkButton, Sheet } from "@/components/ui";
import { CheckIcon, CloseIcon, QueueIcon } from "@/components/icons";
import { GradeButtons } from "@/components/grade-buttons";
import { StudyCardReview } from "@/components/study-card-review";
import {
  countsLabel,
  emptyTally,
  itemsLabel,
  removalCopy,
  sessionSummary,
  tallyWith,
  type ReviewOutcome,
  type SessionTally,
} from "@/lib/daily-review";
import { REVIEW_CHANGED_EVENT } from "@/lib/app-nav";
import type { ReviewGrade } from "@/lib/vocabulary";
import type { DailyItem, DailyReview, DueRecall } from "@/lib/study-review-queries";
import type { HighlightReviewCard, ReviewCard } from "@/lib/types";

/** O que cada item recebe da sessao. */
interface ItemHandlers {
  /** Nota gravada: segue para o proximo. */
  onNext: (kept: boolean) => void;
  onError: (message: string) => void;
  /**
   * O item esta gravando ou ja gravou a resposta e continua na tela (US-223):
   * enquanto isso "Pular" e "Tirar da revisão" nao aparecem, porque o item ja
   * nao esta sem resposta.
   */
  onLock: (locked: boolean) => void;
}

/** Tirar da revisao, pela rota de cada tipo (US-223). */
function removeFromReview(item: DailyItem): Promise<unknown> {
  if (item.kind === "palavra") {
    return apiSend(`/api/palavras/${item.word.id}`, "PATCH", { learned: true });
  }
  if (item.kind === "destaque") {
    return apiSend(`/api/texts/${item.highlight.textId}/destaques/${item.highlight.id}`, "PATCH", {
      review: false,
    });
  }
  if (item.kind === "cartao") return apiSend(`/api/cartoes/${item.card.id}`, "DELETE");
  // A rodada que a tela mostrou: aberta antes da virada do dia 30, ela ja
  // pode ter sido trocada pela seguinte, que nao e a que a folha descreveu.
  return apiSend(`/api/texts/${item.recall.textId}/recordar?rodada=${item.recall.round}`, "DELETE");
}

/**
 * Avisa a barra de navegacao que um item saiu da conta de vencidos (US-229):
 * o selo da aba "Revisar" cai junto, sem esperar a troca de rota.
 */
function announceReviewChange() {
  window.dispatchEvent(new Event(REVIEW_CHANGED_EVENT));
}

/**
 * Revisao do dia (US-161).
 *
 * Um item por vez, de qualquer tipo, na ordem que o servidor montou (os mais
 * atrasados primeiro, intercalados). Cada nota vai para a rota do proprio
 * tipo, as mesmas das revisoes separadas: o item respondido deixa de estar
 * vencido, entao reabrir a tela no mesmo dia continua do proximo.
 *
 * Abaixo do item ficam duas saidas sem nota (US-223): "Pular", que so passa
 * adiante (o item continua vencido e volta ao reabrir a tela), e "Tirar da
 * revisão", que persiste e por isso pede confirmacao. Sem elas um item
 * indesejado travava todos os que vinham depois.
 */
export function DailyReviewClient({ initial }: { initial: DailyReview }) {
  const notify = useToast();
  // Posicao e placar andam juntos: cada item sai da tela uma vez, com um desfecho.
  const [session, setSession] = useState<{ position: number; tally: SessionTally }>(() => ({
    position: 0,
    tally: emptyTally(),
  }));
  // Posicao do item que ja esta gravando ou gravou a resposta.
  const [lockedAt, setLockedAt] = useState<number | null>(null);
  // Posicao do item para o qual a folha de "Tirar da revisão" abriu: se a
  // tela andar com ela aberta, a folha fecha em vez de passar a valer para o
  // item seguinte.
  const [confirmingAt, setConfirmingAt] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");

  // Tocar na aba "Revisar" ja acesa navega para a mesma pagina: o Next busca
  // a lista de novo e mantem este estado. Lista nova, sessao nova - senao a
  // posicao antiga apontaria para outro item, ou para o resumo de novo.
  const [shownFor, setShownFor] = useState(initial);
  if (shownFor !== initial) {
    setShownFor(initial);
    setSession({ position: 0, tally: emptyTally() });
    setLockedAt(null);
    setConfirmingAt(null);
    setRemoveError("");
  }

  const { position, tally } = session;
  const items = initial.items;
  const item = items[position];
  const done = items.length > 0 && position >= items.length;
  const locked = lockedAt === position;
  const summary = sessionSummary(tally);
  const removal = item
    ? removalCopy(item.kind, item.kind === "recordar" ? item.recall.round : undefined)
    : null;

  /**
   * Fecha o item da posicao `at`. So vale se ele ainda e o da tela: a nota que
   * chega depois de um "Pular" nao pode pular tambem o item seguinte.
   */
  const finish = (at: number, outcome: ReviewOutcome) =>
    setSession((current) =>
      current.position === at
        ? { position: at + 1, tally: tallyWith(current.tally, outcome) }
        : current
    );
  const lock = (at: number, on: boolean) =>
    setLockedAt((current) => {
      if (on) return current !== null && current > at ? current : at;
      return current === at ? null : current;
    });
  const fail = (message: string) => notify(message, "error");

  const remove = async () => {
    if (!item || removing || confirmingAt !== position) return;
    setRemoving(true);
    setRemoveError("");
    try {
      try {
        await removeFromReview(item);
      } catch (cause) {
        // 404: o item ja foi apagado ou encerrado em outra aba. Ja esta fora
        // da revisao, que era o pedido.
        if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
      }
      setConfirmingAt(null);
      finish(position, "tirado");
      announceReviewChange();
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause.message : "Não consegui tirar da revisão.");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Sem seta de voltar: a revisao e uma aba da barra de navegacao (US-229). */}
      <header className="pt-2">
        <h1 className="text-headline-small">Revisão do dia</h1>
        {items.length > 0 ? (
          <p className="tabular mt-1 text-sm text-muted" data-testid="contagem-revisao">
            {countsLabel(initial.counts)}
          </p>
        ) : null}
        {items.length > 0 && !done ? (
          <p className="tabular text-sm text-faint">
            {position + 1} de {items.length}
            {initial.total > items.length ? ` · ${initial.total} vencidos no total` : ""}
          </p>
        ) : null}
      </header>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckIcon className="size-7" />}
            title="Revisão em dia."
            description={
              initial.tomorrow > 0
                ? `Amanhã vencem ${itemsLabel(initial.tomorrow)}.`
                : "Nada vence amanhã."
            }
            action={<LinkButton href="/dashboard">Voltar ao início</LinkButton>}
          />
        </Card>
      ) : done ? (
        <Card>
          <div data-testid="resumo-revisao">
            <EmptyState
              // So pulados: nada foi concluido, os itens estao na fila.
              icon={
                tally.answered === 0 && tally.skipped > 0 ? (
                  <QueueIcon className="size-7" />
                ) : (
                  <CheckIcon className="size-7" />
                )
              }
              title={summary.title}
              description={summary.description}
              action={<LinkButton href="/dashboard">Voltar ao início</LinkButton>}
            />
          </div>
        </Card>
      ) : item ? (
        <div data-testid="item-revisao" data-kind={item.kind}>
          <ItemView
            key={item.id}
            item={item}
            onNext={(kept) => {
              finish(position, kept ? "lembrado" : "errado");
              announceReviewChange();
            }}
            onError={fail}
            onLock={(on) => lock(position, on)}
          />
          {locked ? null : (
            // Saidas sem nota, discretas: a acao principal continua no cartao.
            <div className="mt-1 flex items-center justify-between gap-2" data-testid="acoes-revisao">
              <Button variant="ghost" className="min-h-12!" onClick={() => finish(position, "pulado")}>
                Pular
              </Button>
              <Button
                variant="ghost"
                className="min-h-12!"
                onClick={() => {
                  setRemoveError("");
                  setConfirmingAt(position);
                }}
              >
                Tirar da revisão
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <Sheet
        open={confirmingAt === position && removal !== null}
        title={removal?.title ?? ""}
        onClose={() => {
          // Com o pedido em curso a folha espera a resposta.
          if (!removing) setConfirmingAt(null);
        }}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted" data-testid="efeito-tirar">
            {removal?.effect}
          </p>

          {removeError ? <Alert>{removeError}</Alert> : null}

          <Button
            variant={removal?.destructive ? "danger" : "primary"}
            size="lg"
            full
            loading={removing}
            onClick={() => void remove()}
          >
            {removal?.confirm}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function ItemView({ item, onNext, onError, onLock }: { item: DailyItem } & ItemHandlers) {
  if (item.kind === "cartao") {
    return (
      <StudyCardReview
        card={item.card}
        onError={onError}
        // A trava vale desde o toque na nota; depois de "Errei" o cartao fica
        // na tela com a nota ja gravada.
        onGrading={onLock}
        onGraded={() => onLock(true)}
        onDone={(grade) => onNext(grade !== "errei")}
      />
    );
  }
  if (item.kind === "palavra") {
    return <WordItem word={item.word} onNext={onNext} onError={onError} onLock={onLock} />;
  }
  if (item.kind === "destaque") {
    return <HighlightItem highlight={item.highlight} onNext={onNext} onError={onError} onLock={onLock} />;
  }
  return <RecallItem recall={item.recall} onNext={onNext} onLock={onLock} />;
}

/** Nota numa das rotas de revisao ja existentes. */
function useGrade(path: string, id: string, { onNext, onError, onLock }: ItemHandlers) {
  const [busy, setBusy] = useState(false);
  const grade = async (value: ReviewGrade) => {
    if (busy) return;
    setBusy(true);
    onLock(true);
    try {
      await apiSend(path, "POST", { id, grade: value });
      onNext(value !== "errei");
    } catch (cause) {
      // A nota nao entrou: o item volta a poder ser pulado ou tirado.
      onLock(false);
      onError(cause instanceof Error ? cause.message : "Não consegui registrar.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, grade };
}

function Kind({ children }: { children: string }) {
  return <p className="text-xs font-medium uppercase tracking-[0.5px] text-faint">{children}</p>;
}

function WordItem({ word, ...handlers }: { word: ReviewCard } & ItemHandlers) {
  const [revealed, setRevealed] = useState(false);
  const { busy, grade } = useGrade("/api/palavras/revisao", word.id, handlers);

  return (
    <Card className="space-y-5 p-5">
      <div>
        <Kind>Palavra</Kind>
        <p className="mt-1 text-headline-small">{word.word}</p>
        {word.context ? (
          <p className="mt-2 leading-relaxed text-muted">&ldquo;{word.context}&rdquo;</p>
        ) : null}
        {word.textTitle ? <p className="mt-2 text-xs text-faint">em {word.textTitle}</p> : null}
      </div>
      {revealed ? (
        <div className="space-y-2 border-t border-border pt-4" aria-live="polite">
          <p className="font-medium">
            {word.base}
            {word.kind ? <span className="text-sm text-faint"> · {word.kind}</span> : null}
          </p>
          {word.translation ? <p className="font-medium">{word.translation}</p> : null}
          {word.definition.trim() ? (
            <p className="leading-relaxed">{word.definition}</p>
          ) : (
            <p className="text-sm italic text-faint">sem definição</p>
          )}
        </div>
      ) : null}
      {revealed ? (
        <GradeButtons interval={word.interval} busy={busy} onGrade={(value) => void grade(value)} />
      ) : (
        <Button size="lg" full onClick={() => setRevealed(true)}>
          Mostrar resposta
        </Button>
      )}
    </Card>
  );
}

function HighlightItem({ highlight, ...handlers }: { highlight: HighlightReviewCard } & ItemHandlers) {
  const [revealed, setRevealed] = useState(false);
  const { busy, grade } = useGrade("/api/destaques/revisao", highlight.id, handlers);
  // Sem cartao, o modo lacuna da revisao de destaques: a palavra de maior peso some.
  const blank = !highlight.card && !revealed ? highlight.blank : null;

  return (
    <Card className="space-y-5 p-5">
      <div className="space-y-2">
        <Kind>Destaque</Kind>
        {highlight.card ? (
          <p className="text-lg font-medium leading-relaxed">{highlight.card.prompt}</p>
        ) : null}
        {!highlight.card || revealed ? (
          <blockquote className="border-l-2 border-accent pl-3 text-lg leading-relaxed">
            {highlight.words.map((word, index) => (
              <span key={index}>
                {index > 0 ? " " : ""}
                {index === blank ? (
                  <span className="inline-block min-w-16 border-b-2 border-accent align-baseline">
                    <span className="sr-only">palavra escondida</span>
                  </span>
                ) : (
                  word
                )}
              </span>
            ))}
          </blockquote>
        ) : null}
        <p className="text-xs text-faint">
          em{" "}
          <Link href={`/leitor/${highlight.textId}?de=${highlight.start}`} className="text-muted underline">
            {highlight.textTitle}
          </Link>
        </p>
      </div>
      {revealed ? (
        <div className="space-y-2 border-t border-border pt-4" aria-live="polite">
          {highlight.card ? <p className="leading-relaxed">{highlight.card.answer}</p> : null}
          {highlight.note ? (
            <p className="text-sm text-muted">
              <span>Sua nota: </span>
              {highlight.note}
            </p>
          ) : null}
        </div>
      ) : null}
      {revealed ? (
        <GradeButtons interval={highlight.interval} busy={busy} onGrade={(value) => void grade(value)} />
      ) : (
        <Button size="lg" full onClick={() => setRevealed(true)}>
          Mostrar resposta
        </Button>
      )}
    </Card>
  );
}

interface RecallQuestionView {
  prompt: string;
  choices: string[];
}

interface RecallResult {
  score: number;
  original: number;
  results: { prompt: string; choices: string[]; answer: number; given: number | null }[];
}

/**
 * Questionario a recordar (US-169): as perguntas guardadas, com as
 * alternativas reembaralhadas no servidor, e a nota ao lado da original.
 *
 * Pular vale tambem com o questionario aberto (US-223): nada foi enviado, e
 * as respostas marcadas se perdem com o item. Depois de "Corrigir" a nota ja
 * esta gravada, e so resta continuar.
 */
function RecallItem({
  recall,
  onNext,
  onLock,
}: { recall: DueRecall } & Pick<ItemHandlers, "onNext" | "onLock">) {
  const [questions, setQuestions] = useState<RecallQuestionView[] | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<RecallResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const start = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiGet<{ questions: RecallQuestionView[] }>(`/api/texts/${recall.textId}/recordar`);
      setQuestions(data.questions);
      setAnswers(data.questions.map(() => -1));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui abrir o questionário.");
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    setLoading(true);
    setError("");
    onLock(true);
    try {
      setResult(await apiSend<RecallResult>(`/api/texts/${recall.textId}/recordar`, "POST", { answers }));
    } catch (cause) {
      // Nada foi gravado: o questionario volta a poder ser pulado ou dispensado.
      onLock(false);
      setError(cause instanceof Error ? cause.message : "Não consegui corrigir.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="space-y-5 p-5">
      <div>
        <Kind>{`Questionário · ${recall.round} dias depois`}</Kind>
        <p className="mt-1 text-lg font-medium">Recordar: {recall.title}</p>
        <p className="mt-1 text-sm text-muted">
          As mesmas perguntas de quando você concluiu o texto, com as alternativas em outra ordem.
        </p>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      {result ? (
        <div className="space-y-4" aria-live="polite">
          <p className="text-lg" data-testid="nota-recordar">
            Agora: <strong className="tabular">{result.score}%</strong> · na conclusão:{" "}
            <span className="tabular">{result.original}%</span>
          </p>
          <ul className="space-y-3">
            {result.results.map((question, index) => (
              <li key={index} className="text-sm">
                <p className="font-medium">{question.prompt}</p>
                <p className={question.given === question.answer ? "text-positive" : "text-danger"}>
                  {question.given === question.answer ? (
                    <CheckIcon className="mr-1 inline size-4" />
                  ) : (
                    <CloseIcon className="mr-1 inline size-4" />
                  )}
                  {question.choices[question.answer]}
                </p>
              </li>
            ))}
          </ul>
          <Button size="lg" full onClick={() => onNext(result.score >= 50)}>
            Continuar
          </Button>
        </div>
      ) : questions ? (
        <div className="space-y-5">
          {questions.map((question, index) => (
            <fieldset key={index} className="space-y-2">
              <legend className="font-medium">{question.prompt}</legend>
              {question.choices.map((choice, choiceIndex) => (
                <button
                  key={choiceIndex}
                  type="button"
                  aria-pressed={answers[index] === choiceIndex}
                  onClick={() =>
                    setAnswers((current) => current.map((value, at) => (at === index ? choiceIndex : value)))
                  }
                  className={`flex min-h-11 w-full items-start rounded-2xl border px-3 py-2 text-left text-sm transition-colors ${
                    answers[index] === choiceIndex ? "border-accent bg-accent-soft" : "border-border"
                  }`}
                >
                  {choice}
                </button>
              ))}
            </fieldset>
          ))}
          <Button
            size="lg"
            full
            loading={loading}
            disabled={answers.some((answer) => answer < 0)}
            onClick={() => void submit()}
          >
            Corrigir
          </Button>
        </div>
      ) : (
        <Button size="lg" full loading={loading} onClick={() => void start()}>
          Começar
        </Button>
      )}
    </Card>
  );
}
