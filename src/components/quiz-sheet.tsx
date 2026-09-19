"use client";

import { useState } from "react";
import { apiSend } from "@/lib/client";
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
}

/**
 * Questionario de compreensao ao fim da leitura.
 *
 * A correcao acontece no servidor: para conferir aqui, a tela precisaria do
 * gabarito, e o questionario deixaria de medir qualquer coisa. O que chega na
 * abertura sao so enunciado e alternativas.
 */
export function QuizSheet({
  textId,
  open,
  onClose,
  onScored,
}: {
  textId: string;
  open: boolean;
  onClose: () => void;
  onScored?: (score: number) => void;
}) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const start = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiSend<{ quiz: { questions: Question[] } }>(
        `/api/texts/${textId}/questionario`,
        "POST"
      );
      setQuestions(data.quiz.questions);
      setAnswers(Array.from({ length: data.quiz.questions.length }, () => -1));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao consegui montar o questionario.");
    } finally {
      setLoading(false);
    }
  };

  const send = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiSend<{ score: number; results: Result[] }>(
        `/api/texts/${textId}/questionario/respostas`,
        "POST",
        { answers }
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
    }, 200);
  };

  const answered = answers.length > 0 && answers.every((value) => value >= 0);

  return (
    <Sheet open={open} onClose={close} title="Compreensao">
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
                  {item.evidence ? (
                    <p className="border-l-2 border-border pl-3 text-sm text-muted">
                      {item.evidence}
                    </p>
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
        ) : (
          <>
            <p className="text-sm text-muted">
              Algumas perguntas sobre o que voce acabou de ler, para saber se a velocidade esta
              atrapalhando o entendimento.
            </p>
            <p className="text-sm text-faint">
              As perguntas sao geradas por um modelo de linguagem, e para isso o conteudo do texto e
              enviado a um servico externo.
            </p>
            <Button size="lg" full loading={loading} onClick={start}>
              {loading ? <Spinner className="size-5" /> : null}
              {loading ? "Montando as perguntas" : "Comecar"}
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
