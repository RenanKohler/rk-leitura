"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/client";
import { Alert, Button, Spinner } from "@/components/ui";
import { pretestSummary } from "@/lib/study-card-drafts";
import type { PretestAnswer } from "@/lib/study-cards";

interface PretestCard {
  id: string;
  front: string;
  back: string;
}

/**
 * Teste de conhecimento previo (US-170): os cartoes de trechos ainda nao
 * lidos, um por vez. A resposta fica no cartao, fora da revisao espacada.
 * E o unico lugar onde esses cartoes aparecem.
 */
export function PretestSession({ textId, onClose }: { textId: string; onClose: () => void }) {
  const [cards, setCards] = useState<PretestCard[] | null>(null);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answers, setAnswers] = useState<PretestAnswer[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiGet<{ cards: PretestCard[] }>(`/api/texts/${textId}/cartoes-estudo?previo=1`)
      .then((data) => {
        if (active) setCards(data.cards);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Não consegui abrir o teste.");
      });
    return () => {
      active = false;
    };
  }, [textId]);

  const answer = async (value: PretestAnswer) => {
    const card = cards?.[position];
    if (!card) return;
    setSaving(true);
    setError("");
    try {
      await apiSend(`/api/cartoes/${card.id}/previo`, "POST", { answer: value });
      setAnswers((current) => [...current, value]);
      setPosition((current) => current + 1);
      setRevealed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui gravar a resposta.");
    } finally {
      setSaving(false);
    }
  };

  if (!cards) {
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <div className="flex justify-center py-4">
        <Spinner className="size-5" />
      </div>
    );
  }

  const card = cards[position];
  if (!card) {
    const summary = pretestSummary(answers);
    return (
      <div className="space-y-3" data-testid="previo-resumo">
        <p className="font-medium">
          {`Você já sabia ${summary.known} de ${summary.total} (${summary.percent}%).`}
        </p>
        <p className="text-sm text-muted">
          Os cartões entram na revisão quando a leitura passar pelo trecho de cada um.
        </p>
        <Button variant="secondary" full onClick={onClose}>
          Concluir
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="previo-sessao">
      <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">
        Estes cartões são de partes que você ainda não leu.
      </p>
      <p className="tabular text-xs text-faint">{`Cartão ${position + 1} de ${cards.length}`}</p>
      <p className="font-medium" data-testid="previo-frente">
        {card.front}
      </p>
      {revealed ? (
        <>
          <p className="border-l-2 border-accent pl-3 text-sm" data-testid="previo-verso">
            {card.back}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={saving} onClick={() => void answer("nao_sabia")}>
              Não sabia
            </Button>
            <Button disabled={saving} onClick={() => void answer("sabia")}>
              Já sabia
            </Button>
          </div>
        </>
      ) : (
        <Button full onClick={() => setRevealed(true)}>
          Mostrar resposta
        </Button>
      )}
      {error ? <Alert>{error}</Alert> : null}
      <Button variant="ghost" size="sm" onClick={onClose}>
        Sair do teste
      </Button>
    </div>
  );
}
