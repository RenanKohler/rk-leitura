"use client";

import { useState } from "react";
import { ApiError, apiSend, consentFrom } from "@/lib/client";
import { AiConsentNotice, AiOffNotice, useAiConsent } from "@/components/ai-consent";
import { Alert, Button, Sheet, Spinner } from "@/components/ui";
import { CheckIcon, CloseIcon } from "@/components/icons";

interface Question {
  prompt: string;
  choices: string[];
}

interface Result {
  prompt: string;
  choices: string[];
  answer: number;
  given: number | null;
  evidence: string;
  /** Por que a correta e a correta (US-135); ausente nos questionarios antigos. */
  rationale?: string;
  /** Onde a evidencia esta no texto (US-134); ausente quando nao foi achada. */
  position?: { start: number; end: number };
}

/**
 * Questionario de compreensao ao fim da leitura.
 *
 * A correcao acontece no servidor: para conferir aqui, a tela precisaria do
 * gabarito, e o questionario deixaria de medir qualquer coisa. O que chega na
 * abertura sao so enunciado e alternativas.
 *
 * Quando o questionario por IA nao esta disponivel - instalacao sem chave,
 * cota do dia esgotada, texto curto demais - a folha cai nas perguntas de
 * lacuna (PROD-3), montadas do proprio trecho no servidor. A nota vai para a
 * mesma sessao e alimenta o treino do mesmo jeito. A interface do componente
 * nao muda: quem abre a folha nao precisa saber qual das duas respondeu.
 *
 * No resultado, uma pergunta errada oferece "Reler o trecho" (US-134) quando a
 * evidencia foi achada no texto: `onReread` leva o leitor ate ela. A folha so
 * fecha, sem limpar, para que reabrir mostre o mesmo resultado.
 */
export function QuizSheet({
  textId,
  open,
  onClose,
  onScored,
  onReread,
}: {
  textId: string;
  open: boolean;
  onClose: () => void;
  onScored?: (score: number) => void;
  onReread?: (span: { start: number; end: number }) => void;
}) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Qual das duas montou as perguntas, e o trecho das lacunas para a correcao.
  const [kind, setKind] = useState<"ia" | "lacunas">("ia");
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [fallbackNote, setFallbackNote] = useState("");
  // Conta que ainda nao decidiu sobre o envio ao servico de IA (US-125).
  const [asking, setAsking] = useState(false);
  const { state: consent } = useAiConsent();

  const begin = (list: Question[]) => {
    setQuestions(list);
    setAnswers(Array.from({ length: list.length }, () => -1));
  };

  const startCloze = async (note = "") => {
    const data = await apiSend<{ quiz: { questions: Question[] }; from: number; to: number }>(
      `/api/texts/${textId}/lacunas`,
      "POST"
    );
    setKind("lacunas");
    setRange({ from: data.from, to: data.to });
    setFallbackNote(note);
    begin(data.quiz.questions);
  };

  const start = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiSend<{ quiz: { questions: Question[] } }>(
        `/api/texts/${textId}/questionario`,
        "POST"
      );
      setKind("ia");
      begin(data.quiz.questions);
    } catch (cause) {
      if (consentFrom(cause) === "pending") {
        setAsking(true);
        return;
      }
      // Sem permissao (403), sem IA (503), texto curto (422) ou cota do dia (429): as lacunas nao
      // dependem de nada disso. Outros erros continuam aparecendo como erro.
      const unavailable =
        cause instanceof ApiError && [403, 422, 429, 503].includes(cause.status);
      if (unavailable) {
        try {
          await startCloze(cause.message);
        } catch (clozeCause) {
          setError(
            clozeCause instanceof Error ? clozeCause.message : "Não consegui montar as perguntas."
          );
        }
      } else {
        setError(cause instanceof Error ? cause.message : "Não consegui montar o questionário.");
      }
    } finally {
      setLoading(false);
    }
  };

  const startLocal = async () => {
    setLoading(true);
    setError("");
    try {
      await startCloze();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui montar as perguntas.");
    } finally {
      setLoading(false);
    }
  };

  const send = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiSend<{ score: number; results: Result[] }>(
        kind === "lacunas"
          ? `/api/texts/${textId}/lacunas/respostas`
          : `/api/texts/${textId}/questionario/respostas`,
        "POST",
        kind === "lacunas" ? { answers, ...range } : { answers }
      );
      setResults(data.results);
      setScore(data.score);
      onScored?.(data.score);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao enviar as respostas.");
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    onClose();
    // Limpa so depois de fechar: reabrir comeca do zero, e a folha nao pisca
    // com o conteudo sumindo antes da animacao.
    setTimeout(() => {
      setQuestions(null);
      setResults(null);
      setScore(null);
      setAnswers([]);
      setError("");
      setKind("ia");
      setRange(null);
      setFallbackNote("");
      setAsking(false);
    }, 200);
  };

  const answered = answers.length > 0 && answers.every((value) => value >= 0);

  return (
    <Sheet open={open} onClose={close} title="Compreensão">
      <div className="space-y-5">
        {error ? <Alert>{error}</Alert> : null}

        {score !== null && results ? (
          <>
            <div className="text-center">
              <p className="tabular text-3xl font-semibold">{score}%</p>
              <p className="mt-1 text-sm text-muted">
                {`${results.filter((item) => item.given === item.answer).length} de ${results.length} corretas`}
              </p>
            </div>

            <ol className="space-y-4">
              {results.map((item, index) => (
                <li key={index} className="space-y-2">
                  <p className="text-sm font-medium">{item.prompt}</p>
                  <ul className="space-y-1">
                    {item.choices.map((choice, choiceIndex) => {
                      const correct = choiceIndex === item.answer;
                      const chosen = choiceIndex === item.given;
                      if (!correct && !chosen) return null;

                      return (
                        <li
                          key={choiceIndex}
                          className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm ${
                            correct ? "bg-positive-soft text-positive" : "bg-danger-soft text-danger"
                          }`}
                        >
                          {correct ? (
                            <CheckIcon className="mt-0.5 size-4 shrink-0" />
                          ) : (
                            <CloseIcon className="mt-0.5 size-4 shrink-0" />
                          )}
                          <span>{choice}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {item.rationale ? (
                    item.given === item.answer ? (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-muted">Por que está certa</summary>
                        <p className="mt-1">{item.rationale}</p>
                      </details>
                    ) : (
                      <p className="text-sm" data-testid="explicacao">
                        {item.rationale}
                      </p>
                    )
                  ) : null}
                  {item.evidence ? (
                    <p className="border-l-2 border-border pl-3 text-sm text-muted">
                      {item.evidence}
                    </p>
                  ) : null}
                  {item.position && item.given !== item.answer && onReread ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        onReread(item.position!);
                        onClose();
                      }}
                    >
                      Reler o trecho
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>

            <Button size="lg" full onClick={close}>
              Fechar
            </Button>
          </>
        ) : questions ? (
          <>
            {kind === "lacunas" ? (
              <div className="space-y-1" data-testid="lacunas-aviso">
                <p className="text-sm text-muted">
                  Complete cada frase do trecho com a palavra que estava no texto.
                </p>
                {fallbackNote ? (
                  <p className="text-xs text-faint">{`Perguntas montadas aqui mesmo, sem serviço externo. (${fallbackNote})`}</p>
                ) : null}
              </div>
            ) : null}
            <ol className="space-y-5">
              {questions.map((question, index) => (
                <li key={index} className="space-y-2">
                  <p className="text-sm font-medium">{`${index + 1}. ${question.prompt}`}</p>
                  <div className="space-y-1.5">
                    {question.choices.map((choice, choiceIndex) => (
                      <button
                        key={choiceIndex}
                        type="button"
                        onClick={() =>
                          setAnswers((current) =>
                            current.map((value, position) =>
                              position === index ? choiceIndex : value
                            )
                          )
                        }
                        aria-pressed={answers[index] === choiceIndex}
                        className={`flex min-h-11 w-full items-center rounded-2xl border px-3 py-2 text-left text-sm transition-colors ${
                          answers[index] === choiceIndex
                            ? "border-accent bg-accent-soft"
                            : "border-border"
                        }`}
                      >
                        {choice}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ol>

            <Button size="lg" full loading={loading} disabled={!answered} onClick={send}>
              {answered ? "Conferir respostas" : "Responda todas para conferir"}
            </Button>
          </>
        ) : asking ? (
          <AiConsentNotice
            onDecided={(allowed) => {
              setAsking(false);
              void (allowed ? start() : startLocal());
            }}
          />
        ) : consent === "off" ? (
          <>
            <p className="text-sm text-muted">
              Algumas perguntas de lacuna sobre o que você acabou de ler, montadas aqui mesmo.
            </p>
            <AiOffNotice />
            <Button size="lg" full loading={loading} onClick={startLocal}>
              Começar
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Algumas perguntas sobre o que você acabou de ler, para saber se a velocidade está
              atrapalhando o entendimento.
            </p>
            <p className="text-sm text-faint">
              As perguntas são geradas por um modelo de linguagem, e para isso o conteúdo do texto é
              enviado a um serviço externo.
            </p>
            <Button size="lg" full loading={loading} onClick={start}>
              {loading ? <Spinner className="size-5" /> : null}
              {loading ? "Montando as perguntas" : "Começar"}
            </Button>
            {/* Para quem nao quer o texto fora do aparelho: as lacunas sao
                montadas no proprio servidor do app. */}
            <Button variant="ghost" full disabled={loading} onClick={startLocal}>
              Prefiro lacunas, sem serviço externo
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
