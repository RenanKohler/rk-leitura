"use client";

import { useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Alert, Button, Card, EmptyState, LinkButton } from "@/components/ui";
import { BackIcon, CheckIcon, CloseIcon } from "@/components/icons";
import { GradeButtons } from "@/components/grade-buttons";
import { StudyCardReview } from "@/components/study-card-review";
import { countsLabel, itemsLabel } from "@/lib/daily-review";
import type { ReviewGrade } from "@/lib/vocabulary";
import type { DailyItem, DailyReview, DueRecall } from "@/lib/study-review-queries";
import type { HighlightReviewCard, ReviewCard } from "@/lib/types";

/**
 * Revisao do dia (US-161).
 *
 * Um item por vez, de qualquer tipo, na ordem que o servidor montou (os mais
 * atrasados primeiro, intercalados). Cada nota vai para a rota do proprio
 * tipo, as mesmas das revisoes separadas: o item respondido deixa de estar
 * vencido, entao reabrir a tela no mesmo dia continua do proximo.
 */
export function DailyReviewClient({ initial }: { initial: DailyReview }) {
  const notify = useToast();
  const [position, setPosition] = useState(0);
  const [remembered, setRemembered] = useState(0);

  const items = initial.items;
  const item = items[position];
  const done = items.length > 0 && position >= items.length;

  const next = (kept: boolean) => {
    if (kept) setRemembered((count) => count + 1);
    setPosition((current) => current + 1);
  };
  const fail = (message: string) => notify(message, "error");

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-2 pt-2">
        <Link
          href="/dashboard"
          aria-label="Voltar"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        >
          <BackIcon className="size-5" />
        </Link>
        <div className="min-w-0 flex-1 pt-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Revisão do dia</h1>
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
        </div>
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
          <EmptyState
            icon={<CheckIcon className="size-7" />}
            title="Revisão concluída"
            description={`Você lembrou ${remembered} de ${items.length}. O que você errou volta amanhã.`}
            action={<LinkButton href="/dashboard">Voltar ao início</LinkButton>}
          />
        </Card>
      ) : item ? (
        <div data-testid="item-revisao" data-kind={item.kind}>
          <ItemView key={item.id} item={item} onNext={next} onError={fail} />
        </div>
      ) : null}
    </div>
  );
}

function ItemView({
  item,
  onNext,
  onError,
}: {
  item: DailyItem;
  onNext: (kept: boolean) => void;
  onError: (message: string) => void;
}) {
  if (item.kind === "cartao") {
    return (
      <StudyCardReview
        card={item.card}
        onError={onError}
        onDone={(grade) => onNext(grade !== "errei")}
      />
    );
  }
  if (item.kind === "palavra") return <WordItem word={item.word} onNext={onNext} onError={onError} />;
  if (item.kind === "destaque") {
    return <HighlightItem highlight={item.highlight} onNext={onNext} onError={onError} />;
  }
  return <RecallItem recall={item.recall} onNext={onNext} />;
}

/** Nota numa das rotas de revisao ja existentes. */
function useGrade(path: string, id: string, onNext: (kept: boolean) => void, onError: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const grade = async (value: ReviewGrade) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiSend(path, "POST", { id, grade: value });
      onNext(value !== "errei");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Não consegui registrar.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, grade };
}

function Kind({ children }: { children: string }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-faint">{children}</p>;
}

function WordItem({
  word,
  onNext,
  onError,
}: {
  word: ReviewCard;
  onNext: (kept: boolean) => void;
  onError: (message: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const { busy, grade } = useGrade("/api/palavras/revisao", word.id, onNext, onError);

  return (
    <Card className="space-y-5 p-5">
      <div>
        <Kind>Palavra</Kind>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{word.word}</p>
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

function HighlightItem({
  highlight,
  onNext,
  onError,
}: {
  highlight: HighlightReviewCard;
  onNext: (kept: boolean) => void;
  onError: (message: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const { busy, grade } = useGrade("/api/destaques/revisao", highlight.id, onNext, onError);
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
 */
function RecallItem({ recall, onNext }: { recall: DueRecall; onNext: (kept: boolean) => void }) {
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
    try {
      setResult(await apiSend<RecallResult>(`/api/texts/${recall.textId}/recordar`, "POST", { answers }));
    } catch (cause) {
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
