"use client";

import { useEffect, useState } from "react";
import { AiConsentNotice } from "@/components/ai-consent";
import { useToast } from "@/components/providers";
import { Alert, Button, Sheet, Spinner, TextArea } from "@/components/ui";
import { apiSend, ApiError, consentFrom } from "@/lib/client";
import type { Span } from "@/lib/highlights";
import {
  fallbackProposal,
  MAX_PASSAGE_WORDS,
  PASSAGE_TOO_LONG,
  passageWords,
  type CardProposal,
} from "@/lib/passage-card";
import { MAX_CARD_SIDE_CHARS } from "@/lib/study-cards";

type Stage =
  | { state: "longo" }
  | { state: "lendo" }
  | { state: "consentimento" }
  | { state: "form"; notice: string };

/**
 * "Criar cartao" sobre o trecho selecionado no leitor (US-158).
 *
 * Quem monta passa `key`: o pedido comeca na montagem. Trecho de mais de 300
 * palavras nao envia nada. Sem a IA (desligada, sem chave, limite do dia ou
 * falha), o formulario abre com o trecho no verso e a frente vazia.
 */
export function PassageCardSheet({
  textId,
  span,
  words,
  onClose,
}: {
  textId: string;
  span: Span;
  words: string[];
  onClose: () => void;
}) {
  const notify = useToast();
  const tooLong = passageWords(span) > MAX_PASSAGE_WORDS;
  const [stage, setStage] = useState<Stage>(tooLong ? { state: "longo" } : { state: "lendo" });
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (tooLong) return;
    let active = true;
    const fallback = (notice: string) => {
      const proposal = fallbackProposal(words.slice(span.start, span.end).join(" "));
      setFront(proposal.front);
      setBack(proposal.back);
      setStage({ state: "form", notice });
    };
    void apiSend<{ proposal: CardProposal }>(`/api/texts/${textId}/cartao`, "POST", {
      start: span.start,
      end: span.end,
    })
      .then((data) => {
        if (!active) return;
        setFront(data.proposal.front);
        setBack(data.proposal.back);
        setStage({ state: "form", notice: "" });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (consentFrom(cause) === "pending") {
          setStage({ state: "consentimento" });
          return;
        }
        const reason = cause instanceof ApiError ? cause.message : "A IA não respondeu.";
        fallback(`${reason} Complete a frente do cartão.`);
      });
    return () => {
      active = false;
    };
  }, [textId, span.start, span.end, words, tooLong, attempt]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await apiSend(`/api/texts/${textId}/cartao/salvar`, "POST", {
        front,
        back,
        start: span.start,
        end: span.end,
      });
      notify("Cartão criado.", "success");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui salvar o cartão.");
      setSaving(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Criar cartão">
      <div className="space-y-4" data-testid="criar-cartao">
        {stage.state === "longo" ? (
          <Alert>{PASSAGE_TOO_LONG}</Alert>
        ) : stage.state === "lendo" ? (
          <div className="flex items-center gap-3 py-4 text-muted">
            <Spinner className="size-5" />
            Preparando o cartão
          </div>
        ) : stage.state === "consentimento" ? (
          <AiConsentNotice
            onDecided={() => {
              // Com ou sem permissao, pede de novo: recusado, o servidor
              // responde que a IA esta desligada e o formulario abre a mao.
              setStage({ state: "lendo" });
              setAttempt((value) => value + 1);
            }}
          />
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {stage.notice ? <p className="text-sm text-muted">{stage.notice}</p> : null}
            <TextArea
              label="Frente"
              value={front}
              maxLength={MAX_CARD_SIDE_CHARS}
              rows={2}
              onChange={(event) => setFront(event.target.value)}
            />
            <TextArea
              label="Verso"
              value={back}
              maxLength={MAX_CARD_SIDE_CHARS}
              rows={4}
              onChange={(event) => setBack(event.target.value)}
            />
            {error ? <Alert>{error}</Alert> : null}
            <Button type="submit" size="lg" full loading={saving} disabled={!front.trim() || !back.trim()}>
              Salvar cartão
            </Button>
          </form>
        )}
        {stage.state !== "form" ? (
          <Button variant="secondary" size="lg" full onClick={onClose}>
            Voltar à leitura
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}
