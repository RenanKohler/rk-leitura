"use client";

import { useEffect, useRef, useState } from "react";
import { AiConsentNotice, AiOffNotice } from "@/components/ai-consent";
import { Alert, Button, Sheet, Spinner, TextArea } from "@/components/ui";
import { INTERRUPTED } from "@/lib/ai-stream";
import { ApiError, apiGet, apiSend, apiStream, consentFrom } from "@/lib/client";
import {
  answeredUntil,
  appendNote,
  ASK_FAILURE,
  MAX_QUESTION_CHARS,
  MAX_QUESTIONS,
  noteTarget,
  RECENT_ONLY,
  TEXT_CHANGED,
  type Answer,
  type AnswerCitation,
  type StoredTurn,
} from "@/lib/ask";
import type { HighlightItem } from "@/lib/types";

interface Exchange {
  /** Id da pergunta guardada, ou uma chave local enquanto ela e respondida. */
  key: string;
  question: string;
  answer: Answer;
  /** Palavra onde a leitura estava quando a pergunta foi feita. */
  position: number;
  /** Veio de uma sessao anterior da folha (US-147): nao conta no limite. */
  stored: boolean;
  /** O conteudo do texto mudou desde a resposta. */
  stale: boolean;
  status: "lendo" | "pronta" | "interrompida";
  /** Estado de "Guardar como nota" desta resposta (US-129). */
  note?: "salvando" | "salva";
}

const EMPTY_ANSWER: Answer = { text: "", citations: [] };

function fromStored(turn: StoredTurn): Exchange {
  return {
    key: turn.id,
    question: turn.question,
    answer: turn.answer,
    position: turn.position,
    stored: true,
    stale: turn.stale,
    status: "pronta",
  };
}

/**
 * Perguntar ao texto (US-128).
 *
 * Quem monta passa `key={position}`: ler adiante e abrir de novo comeca outra
 * sessao da folha sobre o trecho novo, e voltar de uma citacao reabre a mesma.
 * As perguntas respondidas ficam guardadas (US-147) e voltam ao abrir, com a
 * posicao em que foram feitas; o limite de `MAX_QUESTIONS` conta so a sessao.
 *
 * A resposta aparece enquanto e escrita (US-145); fechar a folha cancela o
 * pedido. Com a folha vazia, ate tres perguntas sugeridas (US-148).
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
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const loaded = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const localKeys = useRef(0);
  // Pergunta que a pessoa permitiu enviar depois do aviso de consentimento.
  const waiting = useRef("");

  // Primeira abertura: conversa guardada e sugestoes. Falha nas duas so deixa
  // a folha como era.
  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    const controller = new AbortController();
    void apiGet<{ turns: StoredTurn[] }>(`/api/texts/${textId}/pergunta`, controller.signal)
      .then(({ turns }) => {
        setExchanges((current) => {
          const known = new Set(current.map((item) => item.key));
          return [...turns.filter((turn) => !known.has(turn.id)).map(fromStored), ...current];
        });
      })
      .catch(() => undefined);
    void fetch(`/api/texts/${textId}/sugestoes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { suggestions?: unknown };
        if (Array.isArray(data.suggestions)) {
          setSuggestions(data.suggestions.filter((item): item is string => typeof item === "string"));
        }
      })
      .catch(() => undefined);
  }, [open, textId, position]);

  // Fechar a folha cancela a resposta em andamento.
  useEffect(() => {
    if (!open) pending.current?.abort();
  }, [open]);
  useEffect(() => () => pending.current?.abort(), []);

  const question = draft.trim();
  const session = exchanges.filter((item) => !item.stored && item.status !== "interrompida");
  const full = session.length >= MAX_QUESTIONS;

  const update = (key: string, change: (item: Exchange) => Exchange) =>
    setExchanges((current) => current.map((item) => (item.key === key ? change(item) : item)));
  const remove = (key: string) =>
    setExchanges((current) => current.filter((item) => item.key !== key));

  const send = async (text: string, replace?: string) => {
    const asked = text.trim();
    if (!asked || sending || full) return;
    localKeys.current += 1;
    const key = `local-${localKeys.current}`;
    const history = exchanges
      .filter((item) => !item.stored && item.status === "pronta")
      .map((item) => ({ question: item.question, answer: item.answer.text }));
    const controller = new AbortController();
    pending.current = controller;
    setSending(true);
    setError("");
    setConfirmingClear(false);
    setExchanges((current) => [
      ...current.filter((item) => item.key !== replace),
      {
        key,
        question: asked,
        answer: EMPTY_ANSWER,
        position,
        stored: false,
        stale: false,
        status: "lendo",
      },
    ]);

    let received = false;
    let finished = false;
    const fail = (message: string) => {
      if (received) {
        update(key, (item) => ({ ...item, status: "interrompida" }));
      } else {
        remove(key);
        setError(message);
      }
    };

    try {
      const result = await apiStream(
        `/api/texts/${textId}/pergunta`,
        { question: asked, position, history },
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "delta") {
              received = true;
              update(key, (item) => ({
                ...item,
                answer: { ...item.answer, text: item.answer.text + event.text },
              }));
            } else if (event.type === "done") {
              finished = true;
              const answer = event.answer as Answer;
              const turn = event.turn as StoredTurn | null;
              update(key, (item) => ({
                ...item,
                key: turn?.id ?? item.key,
                answer,
                status: "pronta",
              }));
              setRecentOnly(Boolean(event.recentOnly));
              // So limpa o campo com a resposta na mao: no limite do dia ou na
              // falha, a pergunta digitada continua ali para tentar de novo.
              setDraft((current) => (current.trim() === asked ? "" : current));
            } else if (event.type === "error") {
              // Recusa: o texto parcial nao vale e sai da tela.
              if (event.refusal) received = false;
              fail(event.error || ASK_FAILURE);
            }
          },
        }
      );
      if (result.status === "json") fail(ASK_FAILURE);
      else if (result.status === "interrupted" && !finished) fail(ASK_FAILURE);
    } catch (cause) {
      if (controller.signal.aborted) {
        // Folha fechada: o trecho recebido fica, com a opcao de tentar de novo.
        if (received) update(key, (item) => ({ ...item, status: "interrompida" }));
        else remove(key);
        return;
      }
      const state = consentFrom(cause);
      remove(key);
      if (state) {
        waiting.current = asked;
        setConsent(state);
      } else {
        setError(cause instanceof ApiError ? cause.message : ASK_FAILURE);
      }
    } finally {
      if (pending.current === controller) pending.current = null;
      setSending(false);
    }
  };

  const decided = (allowed: boolean) => {
    if (allowed) {
      setConsent(null);
      void send(waiting.current || question);
    } else {
      setConsent("off");
    }
  };

  /** "Limpar conversa", depois de confirmar (US-147). */
  const clear = async () => {
    setClearing(true);
    setError("");
    try {
      await apiSend(`/api/texts/${textId}/pergunta`, "DELETE");
      setExchanges([]);
      setRecentOnly(false);
      setConfirmingClear(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Não consegui limpar a conversa.");
    } finally {
      setClearing(false);
    }
  };

  /** Guarda a resposta como nota no primeiro trecho citado (US-129). */
  const saveAsNote = async (exchange: Exchange) => {
    const cited = exchange.answer.citations[0];
    if (!cited) return;
    update(exchange.key, (item) => ({ ...item, note: "salvando" }));
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
      update(exchange.key, (item) => ({ ...item, note: "salva" }));
    } catch (cause) {
      update(exchange.key, (item) => ({ ...item, note: undefined }));
      setError(cause instanceof Error ? cause.message : "Não consegui guardar a nota.");
    }
  };

  const goTo = (citation: AnswerCitation) => {
    onClose();
    onGo(citation.start);
  };

  const askedHere = exchanges.some((item) => !item.stored);
  const answered = exchanges.some((item) => item.status !== "lendo");
  const waitingFirst = exchanges.some((item) => item.status === "lendo" && !item.answer.text);

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

        {exchanges.map((exchange) => (
          <div key={exchange.key} className="space-y-2" data-testid="pergunta-resposta">
            <p className="font-medium">{exchange.question}</p>
            {exchange.stored ? (
              <p className="text-xs text-faint" data-testid="pergunta-posicao">
                {answeredUntil(exchange.position)}
              </p>
            ) : null}
            {exchange.stale ? (
              <p className="text-sm text-muted" data-testid="pergunta-mudou">
                {TEXT_CHANGED}
              </p>
            ) : null}
            {exchange.answer.text ? (
              <p className="whitespace-pre-line leading-relaxed">{exchange.answer.text}</p>
            ) : null}
            {exchange.status === "interrompida" ? (
              <div className="space-y-2" data-testid="pergunta-interrompida">
                <p className="text-sm text-muted">{INTERRUPTED}</p>
                <Button
                  variant="secondary"
                  disabled={sending}
                  onClick={() => void send(exchange.question, exchange.key)}
                >
                  Tentar de novo
                </Button>
              </div>
            ) : null}
            {exchange.status === "pronta" && exchange.answer.citations.length > 0 ? (
              <ul className="space-y-1.5">
                {exchange.answer.citations.map((citation) => (
                  <li key={`${citation.start}-${citation.end}`}>
                    {/* Texto mudado: a posicao citada pode nao ser mais a mesma. */}
                    {exchange.stale ? (
                      <p className="rounded-xl border border-border px-3 py-2 text-sm text-muted">
                        “{citation.quote}”
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => goTo(citation)}
                        aria-label={`Ir para o trecho citado: ${citation.quote}`}
                        className="min-h-11 w-full rounded-xl border border-border px-3 py-2 text-left text-sm text-muted hover:bg-surface-2"
                      >
                        “{citation.quote}”
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {/* Sem citacao nao ha trecho onde guardar (US-129). */}
            {exchange.status === "pronta" &&
            !exchange.stale &&
            exchange.answer.citations.length > 0 ? (
              exchange.note === "salva" ? (
                <p className="text-sm text-faint">Guardada como nota no trecho citado.</p>
              ) : (
                <Button
                  variant="secondary"
                  loading={exchange.note === "salvando"}
                  onClick={() => void saveAsNote(exchange)}
                >
                  Guardar como nota
                </Button>
              )
            ) : null}
            {exchange.stored && exchange.position < position && !full ? (
              <Button
                variant="secondary"
                disabled={sending}
                onClick={() => void send(exchange.question)}
              >
                Perguntar de novo com o trecho atual
              </Button>
            ) : null}
          </div>
        ))}

        {sending && waitingFirst ? (
          <div className="flex items-center gap-3 text-muted">
            <Spinner className="size-5" />
            Lendo o trecho
          </div>
        ) : null}

        {consent === "pending" ? (
          <AiConsentNotice onDecided={decided} />
        ) : consent === "off" ? (
          <AiOffNotice />
        ) : (
          <>
            {error ? <Alert>{error}</Alert> : null}

            {!askedHere && !sending && suggestions.length > 0 ? (
              <div className="space-y-1.5" data-testid="pergunta-sugestoes">
                <p className="text-sm text-muted">Sugestões</p>
                <ul className="space-y-1.5">
                  {suggestions.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        onClick={() => void send(suggestion)}
                        className="min-h-11 w-full rounded-xl border border-border px-3 py-2 text-left text-sm hover:bg-surface-2"
                      >
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {full ? (
              <div className="space-y-2">
                <p className="text-sm text-muted">
                  {`Esta conversa chegou a ${MAX_QUESTIONS} perguntas.`}
                </p>
                <Button
                  variant="secondary"
                  full
                  onClick={() => {
                    // As respostas continuam guardadas; so a contagem recomeca.
                    setExchanges((current) => current.map((item) => ({ ...item, stored: true })));
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
                  void send(question);
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
                      void send(question);
                    }
                  }}
                  hint={`${draft.length}/${MAX_QUESTION_CHARS}`}
                />
                <Button type="submit" size="lg" full loading={sending} disabled={!question}>
                  {sending ? "Pensando" : "Perguntar"}
                </Button>
              </form>
            )}

            {answered && !sending ? (
              confirmingClear ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted">
                    As perguntas e respostas deste texto serão apagadas.
                  </p>
                  <Button variant="danger" full loading={clearing} onClick={() => void clear()}>
                    Confirmar limpeza
                  </Button>
                  <Button variant="ghost" full onClick={() => setConfirmingClear(false)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" full onClick={() => setConfirmingClear(true)}>
                  Limpar conversa
                </Button>
              )
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
