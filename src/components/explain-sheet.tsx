"use client";

import { useEffect, useRef, useState } from "react";
import { AiConsentNotice, AiOffNotice } from "@/components/ai-consent";
import { Alert, Button, Sheet, Spinner } from "@/components/ui";
import { INTERRUPTED, type StreamEvent } from "@/lib/ai-stream";
import { apiStream, ApiError, consentFrom } from "@/lib/client";
import {
  EXPLAIN_FAILURE,
  EXPLAIN_TIMEOUT_MS,
  FOLLOW_UP_LABELS,
  type Explanation,
  type FollowUp,
} from "@/lib/explain";

/** Folga sobre o teto do servidor: banco e rede antes e depois da chamada. */
const CLIENT_TIMEOUT_MS = EXPLAIN_TIMEOUT_MS + 5_000;

const FOLLOW_UPS: FollowUp[] = ["simples", "exemplo"];

/** Explicacao montada com os trechos que chegam (US-145). */
type Draft = { simple: string; translation: string; explanation: string };

const EMPTY_DRAFT: Draft = { simple: "", translation: "", explanation: "" };

/** Continuacao pedida (US-146). */
interface Continuation {
  kind: FollowUp;
  text: string;
  status: "lendo" | "pronta" | "interrompida";
}

function fromExplanation(explanation: Explanation): Draft {
  return {
    simple: explanation.simple,
    translation: explanation.translation ?? "",
    explanation: explanation.explanation,
  };
}

/** Le um evento da explicacao e devolve o rascunho atualizado. */
function applyDelta(draft: Draft, event: Extract<StreamEvent, { type: "delta" }>): Draft {
  const field = event.field;
  if (field !== "simple" && field !== "translation" && field !== "explanation") return draft;
  return { ...draft, [field]: draft[field] + event.text };
}

/**
 * Explicacao de uma frase dificil (US-127).
 *
 * Quem monta passa `key={index}`: o pedido comeca na montagem. A folha nao
 * mexe na posicao de leitura: com a explicacao, com o limite do dia ou com a
 * falha, fechar volta para a mesma palavra.
 *
 * A explicacao aparece enquanto e escrita (US-145); fechar a folha cancela o
 * pedido. Depois dela, "Mais simples" e "Dar um exemplo" pedem outra forma de
 * explicar, uma vez cada (US-146).
 */
export function ExplainSheet({
  textId,
  index,
  onClose,
}: {
  textId: string;
  /** Palavra tocada; a frase vem do segmentador, no servidor. */
  index: number;
  onClose: () => void;
}) {
  const [sentence, setSentence] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [complete, setComplete] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState<"pending" | "off" | null>(null);
  // Muda quando a pessoa permite o envio ou toca "Tentar de novo": refaz o pedido.
  const [attempt, setAttempt] = useState(0);

  const [continuations, setContinuations] = useState<Continuation[]>([]);
  const [followError, setFollowError] = useState("");
  const followAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    let received = false;

    const fail = (message: string) => {
      if (!active) return;
      if (received) setInterrupted(true);
      else setError(message);
    };

    void apiStream(
      `/api/texts/${textId}/explicacao`,
      { index },
      {
        signal: controller.signal,
        onEvent: (event) => {
          if (!active) return;
          if (event.type === "start" && typeof event.sentence === "string") {
            setSentence(event.sentence);
          } else if (event.type === "delta") {
            received = true;
            setDraft((current) => applyDelta(current, event));
          } else if (event.type === "done") {
            const final = event.explanation as Explanation | undefined;
            if (final) setDraft(fromExplanation(final));
            if (typeof event.sentence === "string") setSentence(event.sentence);
            setComplete(true);
          } else if (event.type === "error") {
            // Recusa: o texto parcial nao vale e sai da tela.
            if (event.refusal) {
              received = false;
              setDraft(EMPTY_DRAFT);
            }
            fail(event.error || EXPLAIN_FAILURE);
          }
        },
      }
    )
      .then((result) => {
        if (!active) return;
        if (result.status === "json") {
          const data = result.data as { explanation?: Explanation; sentence?: string };
          if (data.explanation) {
            setDraft(fromExplanation(data.explanation));
            setSentence(data.sentence ?? "");
            setComplete(true);
          } else {
            setError(EXPLAIN_FAILURE);
          }
        } else if (result.status === "interrupted") {
          fail(EXPLAIN_FAILURE);
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        const state = consentFrom(cause);
        if (state) setConsent(state);
        else if (cause instanceof ApiError) setError(cause.message);
        else fail(EXPLAIN_FAILURE);
      })
      .finally(() => clearTimeout(timer));

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [textId, index, attempt]);

  // Fechar a folha no meio de uma continuacao cancela o pedido.
  useEffect(() => () => followAbort.current?.abort(), []);

  const decided = (allowed: boolean) => {
    if (allowed) {
      setConsent(null);
      setAttempt((value) => value + 1);
    } else {
      setConsent("off");
    }
  };

  const retry = () => {
    setDraft(EMPTY_DRAFT);
    setComplete(false);
    setInterrupted(false);
    setError("");
    setAttempt((value) => value + 1);
  };

  const updateContinuation = (kind: FollowUp, change: (item: Continuation) => Continuation) =>
    setContinuations((current) => current.map((item) => (item.kind === kind ? change(item) : item)));

  /** Pede "Mais simples" ou "Dar um exemplo" (US-146). */
  const askFollowUp = async (kind: FollowUp) => {
    followAbort.current?.abort();
    const controller = new AbortController();
    followAbort.current = controller;
    setFollowError("");
    setContinuations((current) => [
      ...current.filter((item) => item.kind !== kind),
      { kind, text: "", status: "lendo" },
    ]);

    let received = false;
    const drop = () => setContinuations((current) => current.filter((item) => item.kind !== kind));
    const fail = (message: string) => {
      if (received) updateContinuation(kind, (item) => ({ ...item, status: "interrompida" }));
      else {
        drop();
        setFollowError(message);
      }
    };

    try {
      const result = await apiStream(
        `/api/texts/${textId}/explicacao`,
        { index, followUp: kind },
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "delta") {
              received = true;
              updateContinuation(kind, (item) => ({ ...item, text: item.text + event.text }));
            } else if (event.type === "done" && typeof event.text === "string") {
              const text = event.text;
              updateContinuation(kind, (item) => ({ ...item, text, status: "pronta" }));
            } else if (event.type === "error") {
              if (event.refusal) received = false;
              fail(event.error || EXPLAIN_FAILURE);
            }
          },
        }
      );
      if (result.status === "json") {
        const text = result.data.text;
        if (typeof text === "string" && text) {
          updateContinuation(kind, (item) => ({ ...item, text, status: "pronta" }));
        } else {
          fail(EXPLAIN_FAILURE);
        }
      } else if (result.status === "interrupted") {
        fail(EXPLAIN_FAILURE);
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      // Limite do dia: o aviso aparece e a explicacao original continua.
      const state = consentFrom(cause);
      if (state) {
        drop();
        setConsent(state);
      } else {
        fail(cause instanceof ApiError ? cause.message : EXPLAIN_FAILURE);
      }
    }
  };

  const loading = !error && !interrupted && !draft.simple && !draft.translation && !draft.explanation;
  const busy = continuations.some((item) => item.status === "lendo");

  return (
    <Sheet open onClose={onClose} title="Explicar frase">
      <div className="space-y-4" data-testid="explicacao">
        {consent === "pending" ? (
          <AiConsentNotice onDecided={decided} />
        ) : consent === "off" ? (
          <AiOffNotice />
        ) : error ? (
          <Alert>{error}</Alert>
        ) : loading ? (
          <div className="flex items-center gap-3 py-4 text-muted">
            <Spinner className="size-5" />
            Explicando
          </div>
        ) : (
          <>
            {sentence ? (
              <blockquote className="border-l-2 border-border pl-3 text-sm text-muted">
                {sentence}
              </blockquote>
            ) : null}
            {/* Frase de outro idioma: a traducao vem antes da reescrita. */}
            {draft.translation ? (
              <div>
                <p className="text-sm text-muted">Tradução</p>
                <p className="leading-relaxed">{draft.translation}</p>
              </div>
            ) : null}
            {draft.simple ? (
              <div>
                <p className="text-sm text-muted">Em outras palavras</p>
                <p className="font-medium leading-relaxed">{draft.simple}</p>
              </div>
            ) : null}
            {draft.explanation ? (
              <div>
                <p className="text-sm text-muted">Explicação</p>
                <p className="leading-relaxed">{draft.explanation}</p>
              </div>
            ) : null}

            {interrupted ? (
              <div className="space-y-2" data-testid="explicacao-interrompida">
                <p className="text-sm text-muted">{INTERRUPTED}</p>
                <Button variant="secondary" onClick={retry}>
                  Tentar de novo
                </Button>
              </div>
            ) : null}

            {continuations.map((item) => (
              <div key={item.kind} data-testid="explicacao-continuacao">
                <p className="text-sm text-muted">{FOLLOW_UP_LABELS[item.kind]}</p>
                {item.text ? (
                  <p className="leading-relaxed">{item.text}</p>
                ) : (
                  <div className="flex items-center gap-3 text-muted">
                    <Spinner className="size-4" />
                    Escrevendo
                  </div>
                )}
                {item.status === "interrompida" ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-sm text-muted">{INTERRUPTED}</p>
                    <Button variant="secondary" onClick={() => void askFollowUp(item.kind)}>
                      Tentar de novo
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}

            {followError ? <Alert>{followError}</Alert> : null}

            {complete ? (
              <div className="flex flex-wrap gap-2">
                {FOLLOW_UPS.map((kind) => (
                  <Button
                    key={kind}
                    variant="secondary"
                    disabled={busy || continuations.some((item) => item.kind === kind)}
                    onClick={() => void askFollowUp(kind)}
                  >
                    {FOLLOW_UP_LABELS[kind]}
                  </Button>
                ))}
              </div>
            ) : null}
          </>
        )}

        <Button size="lg" full onClick={onClose}>
          Voltar à leitura
        </Button>
      </div>
    </Sheet>
  );
}
