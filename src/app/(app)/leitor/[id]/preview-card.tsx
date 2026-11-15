"use client";

import { useCallback, useEffect, useState } from "react";
import { AiConsentNotice, AiOffNotice } from "@/components/ai-consent";
import { CloseIcon } from "@/components/icons";
import { useOffline } from "@/components/offline-provider";
import { Alert, Button, Sheet } from "@/components/ui";
import { apiGet, apiSend, consentFrom } from "@/lib/client";
import type { Preview } from "@/lib/preview";

/*
 * Previa antes de ler (US-233), no leitor.
 *
 * Ao abrir um texto nao comecado, o leitor pergunta ao servidor se ha previa
 * guardada ou se da para gerar uma; o cartao so aparece quando vai
 * funcionar. Gerar e sempre um toque em "Ver prévia": abrir o texto nao gasta
 * chamada. A previa vista fica acessivel durante a leitura ("Mais ações").
 */

type State = "idle" | "loading" | "consent" | "off" | "failed";

export function usePreview(textId: string, enabled: boolean) {
  const { online } = useOffline();
  const [available, setAvailable] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled || !online) return;
    let active = true;
    void apiGet<{ preview: Preview | null; available: boolean }>(`/api/texts/${textId}/previa`)
      .then((data) => {
        if (!active) return;
        setPreview(data.preview);
        setAvailable(data.available);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [enabled, online, textId]);

  const request = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const data = await apiSend<{ preview: Preview }>(`/api/texts/${textId}/previa`, "POST");
      setPreview(data.preview);
      setState("idle");
    } catch (cause) {
      const consent = consentFrom(cause);
      if (consent === "pending") setState("consent");
      else if (consent === "off") setState("off");
      else {
        setState("failed");
        setError(cause instanceof Error ? cause.message : "Não consegui preparar a prévia agora.");
      }
    }
  }, [textId]);

  return { available, preview, state, error, request, setState };
}

function PreviewBody({ preview }: { preview: Preview }) {
  return (
    <div className="space-y-3 text-left text-sm" data-testid="previa-conteudo">
      <p className="text-base leading-relaxed">{preview.about}</p>
      {preview.focus.length > 0 ? (
        <div>
          <p className="font-medium">Preste atenção em</p>
          <ul className="mt-1 list-disc space-y-1 pl-5" aria-label="Em que prestar atenção">
            {preview.focus.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <PreviewQuestions questions={preview.questions} />
    </div>
  );
}

export function PreviewQuestions({ questions }: { questions: string[] }) {
  return (
    <div>
      <p className="font-medium">Leia procurando responder</p>
      <ol className="mt-1 list-decimal space-y-1 pl-5" aria-label="Perguntas da prévia">
        {questions.map((question) => (
          <li key={question}>{question}</li>
        ))}
      </ol>
    </div>
  );
}

/** Cartao flutuante antes de iniciar: "Ver prévia" ou a previa pronta. */
export function PreviewCard({
  controller,
  onStart,
  onDismiss,
}: {
  controller: ReturnType<typeof usePreview>;
  onStart: () => void;
  onDismiss: () => void;
}) {
  const { preview, state, error, request, setState } = controller;
  return (
    <div
      data-testid="cartao-previa"
      className="reader-float-card pointer-events-auto w-full max-w-3xl space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-float"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <p className="font-medium">Prévia</p>
          {preview ? null : (
            <p className="text-sm text-muted">
              Do que trata, em que prestar atenção e duas perguntas para ler buscando a resposta. Sem
              contar o final.
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Dispensar a prévia"
          onClick={onDismiss}
          className="-mr-1 -mt-1 flex size-12 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        >
          <CloseIcon className="size-5" />
        </button>
      </div>

      {preview ? (
        <>
          <PreviewBody preview={preview} />
          <Button full onClick={onStart}>
            Começar a ler
          </Button>
        </>
      ) : state === "consent" ? (
        <AiConsentNotice
          onDecided={(allowed) => {
            if (allowed) void request();
            else setState("off");
          }}
        />
      ) : state === "off" ? (
        <AiOffNotice />
      ) : (
        <>
          {state === "failed" && error ? <Alert>{error}</Alert> : null}
          <Button full loading={state === "loading"} onClick={() => void request()}>
            Ver prévia
          </Button>
        </>
      )}
    </div>
  );
}

/** As duas perguntas durante a leitura, pela folha "Mais ações". */
export function PreviewQuestionsSheet({
  open,
  onClose,
  preview,
}: {
  open: boolean;
  onClose: () => void;
  preview: Preview | null;
}) {
  return (
    <Sheet open={open && preview !== null} onClose={onClose} title="Perguntas da prévia">
      {preview ? (
        <div className="space-y-3 text-sm" data-testid="previa-perguntas">
          <p className="text-muted">{preview.about}</p>
          <PreviewQuestions questions={preview.questions} />
        </div>
      ) : null}
    </Sheet>
  );
}
