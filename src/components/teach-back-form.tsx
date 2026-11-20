"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AiConsentNotice, AiOffNotice } from "@/components/ai-consent";
import { Alert, Button, SelectField, TextArea } from "@/components/ui";
import { apiGet, apiSend, consentFrom } from "@/lib/client";
import { countWords } from "@/lib/reading";
import {
  checkExplanation,
  MAX_EXPLANATION_WORDS,
  NOTHING_READ,
  type ReadPart,
  type TeachBackPoint,
} from "@/lib/teach-back";

const FAILURE = "Não consegui conferir agora.";
const PART_NOT_READ = "Leia esta parte até o fim antes de explicar.";

export function partLabel(part: ReadPart): string {
  if (part.title === null) return "Todo o trecho lido";
  return part.partial ? `${part.title} (até onde você leu)` : part.title;
}

/** Rascunho por texto e parte, no sessionStorage da aba (US-231). */
export function teachBackDraftKey(textId: string, start: number): string {
  return `rk-leitura:explicacao:${textId}:${start}`;
}

function readDraft(key: string | undefined): string {
  if (!key) return "";
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(key: string | undefined, value: string) {
  if (!key) return;
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Sem armazenamento: o rascunho fica so no estado.
  }
}

/**
 * Formulario de "Explicar com as proprias palavras" (US-167), usado na tela
 * Estudar e na folha do leitor (US-231). A rota e o prompt sao os mesmos
 * (`/api/texts/[id]/apontamentos`): aqui so a tela.
 *
 * Com `fixedStart`, a parte vem escolhida (a secao recem-terminada no
 * leitor) e nao ha seletor. `prepare` roda antes de buscar as partes: o
 * leitor grava a posicao, porque o servidor so aceita o que ja foi lido.
 */
export function TeachBackForm({
  textId,
  fixedStart,
  prepare,
  renderQuote,
  draftKey,
  onChecked,
}: {
  textId: string;
  fixedStart?: number;
  prepare?: () => Promise<void>;
  renderQuote: (point: TeachBackPoint) => ReactNode;
  /** Guarda o texto escrito na aba: fechar sem enviar nao o perde. */
  draftKey?: string;
  /** A explicacao foi conferida (chegaram os apontamentos). */
  onChecked?: () => void;
}) {
  const [parts, setParts] = useState<ReadPart[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [explanation, setExplanation] = useState(() => readDraft(draftKey));
  const [points, setPoints] = useState<TeachBackPoint[] | null>(null);
  const [warning, setWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState<"pending" | "off" | null>(null);
  const prepareRef = useRef(prepare);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await prepareRef.current?.().catch(() => undefined);
        const data = await apiGet<{ parts: ReadPart[] }>(`/api/texts/${textId}/apontamentos`);
        if (!active) return;
        if (fixedStart !== undefined) {
          const part = data.parts.find((item) => item.start === fixedStart);
          setParts(part ? [part] : []);
          setChosen(part ? part.start : null);
          return;
        }
        setParts(data.parts);
        // A parte mais recente, onde a leitura esta, vem escolhida.
        setChosen(data.parts[data.parts.length - 1]?.start ?? null);
      } catch {
        if (active) setParts([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [textId, fixedStart]);

  const change = (value: string) => {
    setExplanation(value);
    writeDraft(draftKey, value);
  };

  const send = async (text: string) => {
    setError("");
    setConsent(null);
    setBusy(true);
    try {
      const data = await apiSend<{ points: TeachBackPoint[] }>(`/api/texts/${textId}/apontamentos`, "POST", {
        start: chosen,
        explanation: text,
      });
      setPoints(data.points);
      onChecked?.();
      // Conferida, a explicacao cumpriu o papel: o rascunho sai da aba.
      writeDraft(draftKey, "");
    } catch (cause) {
      const state = consentFrom(cause);
      if (state) setConsent(state);
      else setError(cause instanceof Error ? cause.message : FAILURE);
    } finally {
      setBusy(false);
    }
  };

  const check = () => {
    const checked = checkExplanation(explanation);
    if ("error" in checked) {
      // Nada sai do app com menos de 30 (ou mais de 300) palavras.
      setWarning(checked.error);
      return;
    }
    setWarning("");
    void send(checked.text);
  };

  const size = countWords(explanation);
  const emptyMessage = fixedStart !== undefined ? PART_NOT_READ : NOTHING_READ;

  return (
    <div data-testid="apontamentos" className="space-y-4">
      {parts === null ? null : parts.length === 0 ? (
        <p className="text-sm text-muted">{emptyMessage}</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Escreva o que entendeu e veja o que ficou de fora ou divergiu do texto. Não há nota.
          </p>
          {parts.length > 1 ? (
            <SelectField
              label="Parte já lida"
              value={chosen === null ? "" : String(chosen)}
              onChange={(event) => setChosen(Number(event.target.value))}
              options={parts.map((part) => ({ value: String(part.start), label: partLabel(part) }))}
            />
          ) : (
            <p className="text-sm font-medium">{partLabel(parts[0]!)}</p>
          )}
          <TextArea
            label="Sua explicação"
            rows={6}
            value={explanation}
            onChange={(event) => change(event.target.value)}
            hint={`${size} de ${MAX_EXPLANATION_WORDS} palavras`}
          />
          {warning ? <Alert>{warning}</Alert> : null}
          <Button onClick={check} loading={busy}>
            Conferir
          </Button>
        </>
      )}

      {points !== null ? (
        points.length === 0 ? (
          <p className="text-sm text-muted" data-testid="apontamentos-vazio">
            Nenhum apontamento: a explicação cobre os pontos principais desta parte.
          </p>
        ) : (
          <ul className="space-y-3" aria-label="Apontamentos">
            {points.map((point) => (
              <li key={`${point.start}-${point.text}`} className="space-y-1" data-testid="apontamento">
                <p className="leading-relaxed">{point.text}</p>
                {renderQuote(point)}
              </li>
            ))}
          </ul>
        )
      ) : null}
      {consent === "pending" ? (
        <AiConsentNotice
          onDecided={(allowed) => {
            if (allowed) check();
            else setConsent("off");
          }}
        />
      ) : consent === "off" ? (
        <AiOffNotice />
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}
