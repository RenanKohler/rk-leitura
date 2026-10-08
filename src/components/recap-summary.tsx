"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AiConsentNotice } from "@/components/ai-consent";
import { useOffline } from "@/components/offline-provider";
import { Button, Spinner } from "@/components/ui";
import { apiGet, apiSend, consentFrom } from "@/lib/client";

/**
 * Retomada com resumo (US-130, US-131).
 *
 * Os dois componentes so acrescentam: sem rede, sem chave, com a IA desligada
 * ou sem cota, o leitor fica exatamente como antes - o cartao com Recapitular
 * e Pular, a recapitulacao do capitulo com destaques e final. Nenhuma falha
 * daqui bloqueia a leitura.
 */

interface Summary {
  points: string[];
}

function Points({ points, label }: { points: string[]; label: string }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-left text-sm" aria-label={label}>
      {points.map((point, index) => (
        <li key={index}>{point}</li>
      ))}
    </ul>
  );
}

/**
 * "Resumo do que li" dentro do cartao "Recapitular o contexto" (US-130).
 *
 * Antes de mostrar o botao, pergunta ao servidor se ha resumo guardado ou se
 * da para gerar um: o botao so aparece quando vai funcionar.
 */
export function ReadSummary({
  textId,
  position,
  onContinue,
}: {
  textId: string;
  /** Posicao salva: o resumo cobre ate ela, e nada depois. */
  position: number;
  /** "Continuar a leitura": segue da posicao salva. */
  onContinue: () => void;
}) {
  const { online } = useOffline();
  const [available, setAvailable] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "consent" | "failed">("idle");
  const cachedRef = useRef<Summary | null>(null);

  useEffect(() => {
    if (!online) return;
    let active = true;
    void apiGet<{ available: boolean; summary: Summary | null }>(
      `/api/texts/${textId}/resumo?posicao=${position}`
    )
      .then((data) => {
        if (!active) return;
        cachedRef.current = data.summary;
        setAvailable(data.available);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [online, textId, position]);

  const request = async () => {
    // Guardado no banco: aparece na hora, sem chamada nem cota.
    if (cachedRef.current) {
      setSummary(cachedRef.current);
      return;
    }
    setState("loading");
    try {
      const data = await apiSend<{ summary: Summary }>(`/api/texts/${textId}/resumo`, "POST", {
        posicao: position,
      });
      setSummary(data.summary);
      setState("idle");
    } catch (cause) {
      const consent = consentFrom(cause);
      if (consent === "pending") setState("consent");
      else if (consent === "off") setAvailable(false);
      else setState("failed");
    }
  };

  if (summary) {
    return (
      <div className="space-y-3 border-t border-border pt-3" data-testid="resumo-lido">
        <p className="text-sm font-medium">Resumo do que li</p>
        <Points points={summary.points} label="Resumo do que li" />
        <Button full onClick={onContinue}>
          Continuar a leitura
        </Button>
      </div>
    );
  }

  if (!online || !available) return null;

  if (state === "consent") {
    return (
      <div className="border-t border-border pt-3">
        <AiConsentNotice
          onDecided={(allowed) => {
            if (allowed) void request();
            else setAvailable(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        full
        loading={state === "loading"}
        disabled={state === "loading"}
        onClick={() => void request()}
      >
        Resumo do que li
      </Button>
      {state === "failed" ? (
        <p className="text-center text-xs text-muted" role="status">
          Não consegui resumir agora. Recapitular continua valendo.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Resumo do capitulo anterior antes dos destaques e do final (US-131).
 *
 * Envolve a recapitulacao de hoje (`children`): primeiro o resumo, depois o
 * que ja existia. Qualquer falha - sem rede, sem IA, sem cota - pula direto
 * para os destaques, sem mensagem no caminho.
 */
export function ChapterSummaryGate({
  chapterId,
  title,
  children,
}: {
  /** Id do capitulo anterior, ja concluido. */
  chapterId: string;
  title: string;
  children: ReactNode;
}) {
  const { online } = useOffline();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [step, setStep] = useState<"loading" | "consent" | "summary" | "done">(
    online ? "loading" : "done"
  );
  // Muda quando a pessoa permite o envio: refaz o pedido.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!online) return;
    let active = true;
    void apiSend<{ summary: Summary }>(`/api/texts/${chapterId}/resumo-capitulo`, "POST")
      .then((data) => {
        if (!active) return;
        setSummary(data.summary);
        // Quem pulou enquanto esperava ja esta nos destaques: nao volta.
        setStep((current) =>
          current !== "loading" ? current : data.summary.points.length > 0 ? "summary" : "done"
        );
      })
      .catch((cause) => {
        if (!active) return;
        const next = consentFrom(cause) === "pending" ? "consent" : "done";
        setStep((current) => (current === "loading" ? next : current));
      });
    return () => {
      active = false;
    };
  }, [online, chapterId, attempt]);

  if (step === "done" || !online) return <>{children}</>;

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center"
      data-testid="resumo-capitulo"
    >
      <p className="text-sm font-semibold">{`Antes: ${title}`}</p>
      <div className="w-full max-w-2xl space-y-4">
        {step === "loading" ? (
          <p className="flex items-center justify-center gap-2 text-sm text-muted" role="status">
            <Spinner />
            Resumindo o capítulo anterior…
          </p>
        ) : step === "consent" ? (
          <div className="text-left">
            <AiConsentNotice
              onDecided={(allowed) => {
                if (allowed) {
                  setStep("loading");
                  setAttempt((value) => value + 1);
                } else {
                  setStep("done");
                }
              }}
            />
          </div>
        ) : summary ? (
          <>
            <p className="text-sm font-medium text-muted">Resumo do capítulo</p>
            <Points points={summary.points} label="Resumo do capítulo anterior" />
          </>
        ) : null}
      </div>
      {step === "summary" ? (
        <Button onClick={() => setStep("done")}>Ver destaques e o final</Button>
      ) : step === "loading" ? (
        <Button variant="ghost" onClick={() => setStep("done")}>
          Pular o resumo
        </Button>
      ) : null}
    </div>
  );
}
