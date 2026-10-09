"use client";

import { useRef, useState } from "react";
import { AiConsentNotice, AiOffNotice } from "@/components/ai-consent";
import { Alert, Button, Sheet, Spinner, TextArea } from "@/components/ui";
import { ApiError, apiGet, apiSend, consentFrom } from "@/lib/client";
import {
  appendNote,
  ASK_FAILURE,
  MAX_QUESTION_CHARS,
  MAX_QUESTIONS,
  noteTarget,
  RECENT_ONLY,
  type Answer,
  type AnswerCitation,
} from "@/lib/ask";
import type { HighlightItem } from "@/lib/types";

interface Exchange {
  question: string;
  answer: Answer;
  /** Estado de "Guardar como nota" desta resposta (US-129). */
  note?: "salvando" | "salva";
}

/**
 * Perguntar ao texto (US-128).
 *
 * A conversa vive na folha e nao e gravada: quem monta passa
 * `key={position}`, entao ler adiante e abrir de novo comeca outra conversa
 * sobre o trecho novo, e voltar de uma citacao reabre a mesma.
 *
 * Tocar numa citacao fecha a folha e leva o leitor a palavra citada pelo
 * `onGo`, que nao move o lugar da leitura: o leitor oferece "Voltar para onde
 * parou" (US-109).
 */
export function AskSheet({
  open,
  onClose,
  textId,
  position,
  onGo,
  onHighlights,
}: {
  open: boolean;
  onClose: () => void;
  textId: string;
  /** Palavra onde a leitura parou: o documento enviado termina nela. */
  position: number;
  onGo: (position: number) => void;
  /** Destaques depois de guardar uma resposta como nota. */
  onHighlights: (items: HighlightItem[]) => void;
}) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState<"pending" | "off" | null>(null);
  const [recentOnly, setRecentOnly] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const question = draft.trim();
  const full = exchanges.length >= MAX_QUESTIONS;

  const send = async () => {
    if (!question || sending || full) return;
    setSending(true);
    setError("");
    try {
      const data = await apiSend<{ answer: Answer; recentOnly: boolean }>(
        `/api/texts/${textId}/pergunta`,
        "POST",
        {
          question,
          position,
          history: exchanges.map((item) => ({ question: item.question, answer: item.answer.text })),
        }
      );
      setExchanges((current) => [...current, { question, answer: data.answer }]);
      setRecentOnly(data.recentOnly);
      // So limpa o campo com a resposta na mao: no limite do dia ou na falha,
      // a pergunta digitada continua ali para tentar de novo.
      setDraft("");
    } catch (cause) {
      const state = consentFrom(cause);
      if (state) setConsent(state);
      else setError(cause instanceof ApiError ? cause.message : ASK_FAILURE);
    } finally {
      setSending(false);
    }
  };

  const decided = (allowed: boolean) => {
    if (allowed) {
      setConsent(null);
      void send();
    } else {
      setConsent("off");
    }
  };

  const markNote = (index: number, note: Exchange["note"]) =>
    setExchanges((current) =>
      current.map((item, position) => (position === index ? { ...item, note } : item))
    );

  /** Guarda a resposta como nota no primeiro trecho citado (US-129). */
  const saveAsNote = async (index: number) => {
    const exchange = exchanges[index];
    const cited = exchange?.answer.citations[0];
    if (!exchange || !cited) return;
    markNote(index, "salvando");
    setError("");
    try {
      const base = `/api/texts/${textId}/destaques`;
      const { highlights } = await apiGet<{ highlights: HighlightItem[] }>(base);
      // Trecho ja destacado: a resposta entra na nota dele, sem outro destaque.
      let target = noteTarget(highlights, cited);
      let list = highlights;
      if (!target) {
        const created = await apiSend<{ id?: string; highlights: HighlightItem[] }>(base, "POST", {
          start: cited.start,
          end: cited.end,
        });
        list = created.highlights;
        target = list.find((item) => item.id === created.id) ?? null;
      }
      if (!target) throw new Error("Não consegui guardar a nota.");

      const note = appendNote(target.note, exchange.answer.text);
      await apiSend(`${base}/${target.id}`, "PATCH", { note });
      const id = target.id;
      onHighlights(list.map((item) => (item.id === id ? { ...item, note } : item)));
      markNote(index, "salva");
    } catch (cause) {
      markNote(index, undefined);
      setError(cause instanceof Error ? cause.message : "Não consegui guardar a nota.");
    }
  };

  const goTo = (citation: AnswerCitation) => {
    onClose();
    onGo(citation.start);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Perguntar ao texto" initialFocus={fieldRef}>
      <div className="space-y-4" data-testid="perguntar">
        {exchanges.length === 0 ? (
          <p className="text-sm text-muted">
            A resposta usa só o que você já leu, até onde a leitura parou, e mostra o trecho que a
            sustenta.
          </p>
        ) : null}

        {recentOnly ? (
          <p className="text-sm text-muted" data-testid="pergunta-recorte">
            {RECENT_ONLY}
          </p>
        ) : null}

        {exchanges.map((exchange, index) => (
          <div key={index} className="space-y-2" data-testid="pergunta-resposta">
            <p className="font-medium">{exchange.question}</p>
            <p className="whitespace-pre-line leading-relaxed">{exchange.answer.text}</p>
            {exchange.answer.citations.length > 0 ? (
              <ul className="space-y-1.5">
                {exchange.answer.citations.map((citation) => (
                  <li key={`${citation.start}-${citation.end}`}>
                    <button
                      type="button"
                      onClick={() => goTo(citation)}
                      aria-label={`Ir para o trecho citado: ${citation.quote}`}
                      className="min-h-11 w-full rounded-xl border border-border px-3 py-2 text-left text-sm text-muted hover:bg-surface-2"
                    >
                      “{citation.quote}”
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {/* Sem citacao nao ha trecho onde guardar (US-129). */}
            {exchange.answer.citations.length > 0 ? (
              exchange.note === "salva" ? (
                <p className="text-sm text-faint">Guardada como nota no trecho citado.</p>
              ) : (
                <Button
                  variant="secondary"
                  loading={exchange.note === "salvando"}
                  onClick={() => void saveAsNote(index)}
                >
                  Guardar como nota
                </Button>
              )
            ) : null}
          </div>
        ))}

        {consent === "pending" ? (
          <AiConsentNotice onDecided={decided} />
        ) : consent === "off" ? (
          <AiOffNotice />
        ) : (
          <>
            {error ? <Alert>{error}</Alert> : null}
            {full ? (
              <div className="space-y-2">
                <p className="text-sm text-muted">
                  {`Esta conversa chegou a ${MAX_QUESTIONS} perguntas.`}
                </p>
                <Button
                  variant="secondary"
                  full
                  onClick={() => {
                    setExchanges([]);
                    setRecentOnly(false);
                    setError("");
                  }}
                >
                  Começar outra conversa
                </Button>
              </div>
            ) : (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <TextArea
                  ref={fieldRef}
                  label="Sua pergunta"
                  rows={3}
                  maxLength={MAX_QUESTION_CHARS}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  hint={`${draft.length}/${MAX_QUESTION_CHARS}`}
                />
                <Button type="submit" size="lg" full loading={sending} disabled={!question}>
                  {sending ? "Pensando" : "Perguntar"}
                </Button>
              </form>
            )}
          </>
        )}

        {sending && exchanges.length === 0 ? (
          <div className="flex items-center gap-3 text-muted">
            <Spinner className="size-5" />
            Lendo o trecho
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
