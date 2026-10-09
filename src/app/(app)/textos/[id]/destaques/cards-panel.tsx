"use client";

import { useState } from "react";
import { apiSend, consentFrom } from "@/lib/client";
import { AiConsentNotice, AiOffNotice } from "@/components/ai-consent";
import { useToast } from "@/components/providers";
import { Button, Card, SectionTitle, TextArea } from "@/components/ui";
import { SparkIcon, TrashIcon } from "@/components/icons";
import {
  MAX_CARD_ANSWER_CHARS,
  MAX_CARD_PROMPT_CHARS,
  MIN_HIGHLIGHTS_FOR_CARDS,
  type HighlightCardDraft,
} from "@/lib/highlight-cards";
import type { HighlightItem } from "@/lib/types";

/**
 * Cartoes de revisao a partir dos destaques (US-150).
 *
 * "Criar cartoes" pede ao modelo ate um cartao por destaque; nada e gravado
 * antes da revisao aqui: cada cartao pode ser editado ou descartado, e so os
 * que sobram sao salvos no destaque de origem. Depois eles entram na revisao
 * de destaques, nos mesmos intervalos das palavras.
 */
export function CardsPanel({
  textId,
  items,
  onSaved,
}: {
  textId: string;
  items: HighlightItem[];
  onSaved: (cards: HighlightCardDraft[]) => void;
}) {
  const notify = useToast();
  const [drafts, setDrafts] = useState<HighlightCardDraft[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState<"pending" | "off" | null>(null);

  const enough = items.length >= MIN_HIGHLIGHTS_FOR_CARDS;
  const withCards = items.filter((item) => item.card).length;
  const excerptOf = new Map(items.map((item) => [item.id, item.excerpt]));

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const data = await apiSend<{ cards: HighlightCardDraft[] }>(
        `/api/texts/${textId}/destaques/cartoes`,
        "POST"
      );
      setDrafts(data.cards);
      setConsent(null);
    } catch (cause) {
      const state = consentFrom(cause);
      if (state) {
        setConsent(state);
        return;
      }
      setError(cause instanceof Error ? cause.message : "Não consegui criar os cartões agora.");
    } finally {
      setGenerating(false);
    }
  };

  const change = (index: number, field: "prompt" | "answer", value: string) =>
    setDrafts((current) =>
      current ? current.map((card, at) => (at === index ? { ...card, [field]: value } : card)) : current
    );

  const discard = (index: number) =>
    setDrafts((current) => (current ? current.filter((_, at) => at !== index) : current));

  const complete = drafts?.every((card) => card.prompt.trim() && card.answer.trim()) ?? false;

  const save = async () => {
    if (!drafts || drafts.length === 0) return;
    setSaving(true);
    setError("");
    try {
      const data = await apiSend<{ cards: HighlightCardDraft[] }>(
        `/api/texts/${textId}/destaques/cartoes`,
        "PUT",
        { cards: drafts }
      );
      onSaved(data.cards);
      setDrafts(null);
      notify(
        data.cards.length === 1 ? "1 cartão salvo." : `${data.cards.length} cartões salvos.`,
        "success"
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui salvar os cartões.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-6 space-y-3 p-4">
      <SectionTitle>Cartões de revisão</SectionTitle>

      {consent === "pending" ? (
        <AiConsentNotice
          onDecided={(allowed) => {
            setConsent(allowed ? null : "off");
            if (allowed) void generate();
          }}
        />
      ) : drafts ? (
        <>
          <p className="text-sm text-muted">
            Revise cada cartão antes de salvar: edite o que quiser e descarte o que não ajuda.
          </p>
          {drafts.length === 0 ? (
            <p className="text-sm text-faint">Todos os cartões foram descartados.</p>
          ) : (
            <ol className="space-y-4">
              {drafts.map((card, index) => (
                <li
                  key={card.highlightId}
                  className="space-y-3 rounded-2xl border border-border p-3"
                  data-testid="cartao-rascunho"
                >
                  <blockquote className="border-l-2 border-mark pl-3 text-sm text-muted">
                    {excerptOf.get(card.highlightId) ?? ""}
                  </blockquote>
                  <TextArea
                    label={`Pergunta ${index + 1}`}
                    rows={2}
                    maxLength={MAX_CARD_PROMPT_CHARS}
                    value={card.prompt}
                    onChange={(event) => change(index, "prompt", event.target.value)}
                  />
                  <TextArea
                    label={`Resposta ${index + 1}`}
                    rows={3}
                    maxLength={MAX_CARD_ANSWER_CHARS}
                    value={card.answer}
                    onChange={(event) => change(index, "answer", event.target.value)}
                  />
                  <Button variant="ghost" size="sm" onClick={() => discard(index)}>
                    <TrashIcon className="size-4" />
                    Descartar
                  </Button>
                </li>
              ))}
            </ol>
          )}
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="secondary" full disabled={saving} onClick={() => setDrafts(null)}>
              Cancelar
            </Button>
            <Button
              full
              loading={saving}
              disabled={drafts.length === 0 || !complete}
              onClick={() => void save()}
            >
              {drafts.length === 1 ? "Salvar 1 cartão" : `Salvar ${drafts.length} cartões`}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            {withCards > 0
              ? `${withCards === 1 ? "1 destaque tem cartão" : `${withCards} destaques têm cartão`}. Eles entram na revisão de destaques, com a pergunta antes do trecho.`
              : "Uma pergunta e uma resposta por destaque, revisadas nos mesmos intervalos das palavras. Só os trechos destacados e as notas são enviados."}
          </p>
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          {consent === "off" ? <AiOffNotice /> : null}
          <Button
            variant="secondary"
            full
            loading={generating}
            disabled={!enough || consent === "off"}
            onClick={() => void generate()}
          >
            <SparkIcon className="size-5" />
            {withCards > 0 ? "Criar cartões de novo" : "Criar cartões"}
          </Button>
          {!enough ? (
            <p className="text-sm text-faint" data-testid="cartoes-minimo">
              {`Destaque pelo menos ${MIN_HIGHLIGHTS_FOR_CARDS} trechos.`}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
