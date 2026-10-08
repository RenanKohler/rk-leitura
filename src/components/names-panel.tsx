"use client";

import { useEffect, useMemo, useState } from "react";
import { AiConsentNotice } from "@/components/ai-consent";
import { useOffline } from "@/components/offline-provider";
import { Button } from "@/components/ui";
import { XrayPanel } from "@/components/xray-panel";
import { apiGet, apiSend, consentFrom } from "@/lib/client";
import type { Paragraph } from "@/lib/reading";
import { namesInText } from "@/lib/xray";

type Descriptions = Record<string, string | null>;

/**
 * "Nomes no texto" com quem e quem ate onde li (US-132).
 *
 * A lista e a contagem continuam vindo do X-Ray local; o botao "Descrever com
 * IA" so aparece quando vai funcionar. Abrir a lista ja traz as descricoes
 * guardadas que ainda valem (menos de 10% lido desde elas), sem chamada nova.
 * Sem IA, o painel fica exatamente como antes.
 */
export function NamesPanel({
  textId,
  position,
  words,
  paragraphs,
  onGo,
}: {
  textId: string;
  /** Palavra atual: as descricoes usam so o trecho ate ela. */
  position: number;
  words: string[];
  paragraphs: Paragraph[];
  onGo: (index: number) => void;
}) {
  const { online } = useOffline();
  const names = useMemo(() => namesInText(words, paragraphs), [words, paragraphs]);
  const [descriptions, setDescriptions] = useState<Descriptions | null>(null);
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "consent" | "failed">("idle");
  // A posicao de quando a lista abriu: andar com ela aberta nao refaz a consulta.
  const [opened] = useState(position);

  useEffect(() => {
    if (!online || names.length === 0) return;
    let active = true;
    void apiGet<{ available: boolean; descriptions: Descriptions | null }>(
      `/api/texts/${textId}/nomes?posicao=${opened}`
    )
      .then((data) => {
        if (!active) return;
        setDescriptions(data.descriptions);
        setAvailable(data.available);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [online, names.length, textId, opened]);

  const describe = async () => {
    setState("loading");
    try {
      const data = await apiSend<{ descriptions: Descriptions }>(
        `/api/texts/${textId}/nomes`,
        "POST",
        { posicao: opened }
      );
      setDescriptions(data.descriptions);
      setState("idle");
    } catch (cause) {
      const consent = consentFrom(cause);
      if (consent === "pending") setState("consent");
      else if (consent === "off") setAvailable(false);
      else setState("failed");
    }
  };

  const offer = online && available && !descriptions && names.length > 0;

  return (
    <div className="space-y-2">
      {offer && state === "consent" ? (
        <div className="rounded-2xl border border-border p-3">
          <AiConsentNotice
            onDecided={(allowed) => {
              if (allowed) void describe();
              else {
                setAvailable(false);
                setState("idle");
              }
            }}
          />
        </div>
      ) : offer ? (
        <div className="space-y-1">
          <Button
            variant="secondary"
            size="sm"
            full
            loading={state === "loading"}
            disabled={state === "loading"}
            onClick={() => void describe()}
          >
            Descrever com IA
          </Button>
          <p className="text-center text-xs text-faint">
            {state === "failed"
              ? "Não consegui descrever agora."
              : "Usa só o que você já leu, até a palavra atual."}
          </p>
        </div>
      ) : null}
      <XrayPanel
        words={words}
        paragraphs={paragraphs}
        names={names}
        descriptions={descriptions}
        onGo={onGo}
      />
    </div>
  );
}
