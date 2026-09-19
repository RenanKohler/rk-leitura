"use client";

import { useRef, useState } from "react";
import { apiGet, apiSend } from "@/lib/client";
import { Alert, Button, Card, Spinner } from "@/components/ui";
import { CheckIcon, CloseIcon, SpeedIcon } from "@/components/icons";
import { formatClock, formatNumber } from "@/lib/reading";
import { minSeconds } from "@/lib/placement";

interface Material {
  title: string;
  text: string;
  words: number;
  questions: { prompt: string; choices: string[] }[];
}

interface Result {
  wpm: number;
  comprehension: number;
  suggested: number;
  reason: string;
  applied: boolean;
  results: { prompt: string; choices: string[]; answer: number; given: number | null }[];
}

type Phase = "convite" | "lendo" | "perguntas" | "resultado";

/**
 * Teste de velocidade inicial.
 *
 * A leitura e sem avanco automatico de proposito: o teste mede o ritmo
 * natural de quem le, nao a velocidade que o proprio app impoe. O cronometro
 * comeca no toque e para em "Terminei".
 */
export function PlacementTest({
  onApplied,
  onSkip,
}: {
  onApplied?: (wpm: number) => void;
  onSkip?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("convite");
  const [material, setMaterial] = useState<Material | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const startedAt = useRef(0);
  // A duracao vira estado assim que o leitor toca em "Terminei": dali em
  // diante ela e conteudo da tela, e nao so um valor entre dois eventos.
  const [durationMs, setDurationMs] = useState(0);

  const begin = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiGet<Material>("/api/teste-de-leitura");
      setMaterial(data);
      setAnswers(Array.from({ length: data.questions.length }, () => -1));
      startedAt.current = Date.now();
      setPhase("lendo");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao consegui abrir o teste.");
    } finally {
      setLoading(false);
    }
  };

  const finishReading = () => {
    setDurationMs(Date.now() - startedAt.current);
    setPhase("perguntas");
  };

  const send = async (accept: boolean) => {
    setLoading(true);
    setError("");
    try {
      const data = await apiSend<Result>("/api/teste-de-leitura", "POST", {
        durationMs,
        answers,
        accept,
      });
      setResult(data);
      setPhase("resultado");
      if (data.applied) onApplied?.(data.suggested);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao consegui calcular o resultado.");
    } finally {
      setLoading(false);
    }
  };

  const answered = answers.length > 0 && answers.every((value) => value >= 0);
  const floor = material ? minSeconds(material.words) : 0;
  const tooFast = durationMs > 0 && durationMs < floor * 1000;

  if (phase === "convite") {
    return (
      <Card className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <SpeedIcon className="size-5" />
          </div>
          <div>
            <h2 className="font-semibold tracking-tight">Teste de velocidade</h2>
            <p className="mt-1 text-sm text-muted">
              Leia um texto curto no seu ritmo e responda cinco perguntas. Em cerca de tres
              minutos o app sugere uma velocidade que voce consegue acompanhar.
            </p>
          </div>
        </div>

        {error ? <Alert>{error}</Alert> : null}

        <div className="flex flex-col gap-2">
          <Button size="lg" full loading={loading} onClick={() => void begin()}>
            Comecar o teste
          </Button>
          {onSkip ? (
            <Button variant="ghost" size="lg" full onClick={onSkip}>
              Agora nao
            </Button>
          ) : null}
        </div>
      </Card>
    );
  }

  if (phase === "lendo" && material) {
    return (
      <Card className="space-y-4 p-5">
        <div>
          <p className="text-sm text-muted">Leia no seu ritmo normal</p>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight">{material.title}</h2>
        </div>

        <div className="reader-prose max-h-[60dvh] overflow-y-auto">
          {material.text.split(/\n\n+/).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>

        <Button size="lg" full onClick={finishReading}>
          <CheckIcon className="size-5" />
          Terminei
        </Button>
        <p className="text-center text-sm text-faint">
          {`${formatNumber(material.words)} palavras`}
        </p>
      </Card>
    );
  }

  if (phase === "perguntas" && material) {
    return (
      <Card className="space-y-5 p-5">
        <div>
          <h2 className="font-semibold tracking-tight">Cinco perguntas sobre o texto</h2>
          <p className="mt-1 text-sm text-muted">
            {`Tempo de leitura: ${formatClock(durationMs)}`}
          </p>
        </div>

        {error ? <Alert>{error}</Alert> : null}
        {tooFast ? (
          <Alert>
            A leitura levou menos de {floor} segundos, que e o tempo minimo para ler este
            texto no ritmo mais rapido que o app aceita. Refaca o teste lendo o texto inteiro.
          </Alert>
        ) : null}

        <ol className="space-y-5">
          {material.questions.map((question, index) => (
            <li key={index} className="space-y-2">
              <p className="text-sm font-medium">{`${index + 1}. ${question.prompt}`}</p>
              <div className="space-y-1.5">
                {question.choices.map((choice, choiceIndex) => (
                  <button
                    key={choiceIndex}
                    type="button"
                    aria-pressed={answers[index] === choiceIndex}
                    onClick={() =>
                      setAnswers((current) =>
                        current.map((value, position) =>
                          position === index ? choiceIndex : value
                        )
                      )
                    }
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

        <Button
          size="lg"
          full
          loading={loading}
          disabled={!answered || tooFast}
          onClick={() => void send(false)}
        >
          {answered ? "Ver o resultado" : "Responda todas para continuar"}
        </Button>
      </Card>
    );
  }

  if (phase === "resultado" && result) {
    return (
      <Card className="space-y-5 p-5">
        <div className="grid grid-cols-2 divide-x divide-border text-center">
          <div>
            <p className="tabular text-3xl font-semibold">{result.wpm}</p>
            <p className="text-sm text-muted">ppm medido</p>
          </div>
          <div>
            <p className="tabular text-3xl font-semibold">{result.comprehension}%</p>
            <p className="text-sm text-muted">compreensao</p>
          </div>
        </div>

        <div className="rounded-2xl bg-surface-2 p-4 text-center">
          <p className="text-sm text-muted">Velocidade sugerida</p>
          <p className="tabular mt-1 text-3xl font-semibold text-accent">
            {`${result.suggested} ppm`}
          </p>
          <p className="mt-2 text-sm text-muted">{result.reason}</p>
        </div>

        {/* A pergunta aparece sempre; o que muda e a resposta certa embaixo
            das erradas. Mostrar so a alternativa correta ao lado de um X
            fazia parecer que ela e que estava errada. */}
        <ol className="space-y-3">
          {result.results.map((item, index) => {
            const right = item.given === item.answer;
            return (
              <li key={index} className="flex items-start gap-2 text-sm">
                {right ? (
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-positive" />
                ) : (
                  <CloseIcon className="mt-0.5 size-4 shrink-0 text-danger" />
                )}
                <div className="min-w-0">
                  <p className={right ? "text-muted" : ""}>{item.prompt}</p>
                  {right ? null : (
                    <p className="mt-0.5 text-muted">
                      <span className="text-faint">Resposta certa: </span>
                      {item.choices[item.answer]}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {error ? <Alert>{error}</Alert> : null}

        {result.applied ? (
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-positive">
            <CheckIcon className="size-5" />
            {`${result.suggested} ppm agora e a sua velocidade base.`}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button size="lg" full loading={loading} onClick={() => void send(true)}>
              {loading ? <Spinner className="size-5" /> : null}
              Usar {result.suggested} ppm
            </Button>
            <Button variant="ghost" size="lg" full onClick={() => setPhase("convite")}>
              Manter a velocidade atual
            </Button>
          </div>
        )}
      </Card>
    );
  }

  return null;
}
