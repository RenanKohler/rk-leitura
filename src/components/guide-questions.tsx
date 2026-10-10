"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AiConsentNotice, AiOffNotice } from "@/components/ai-consent";
import { Alert, Button, Sheet, Spinner } from "@/components/ui";
import { apiGet, apiSend, ApiError, consentFrom } from "@/lib/client";
import {
  GUIDE_OPTION_EVENT,
  GUIDE_OPTION_KEY,
  guideTrigger,
  NO_SECTIONS,
  type GuideQuestion,
} from "@/lib/guide-questions";
import type { Paragraph } from "@/lib/reading";
import { navigationHeadings, type Section } from "@/lib/sections";
import { sectionIndexAt, sectionRanges } from "@/lib/text-sections";

/*
 * Perguntas-guia antes de ler uma secao (US-166).
 *
 * A opcao e por aparelho, em localStorage: o ajuste da conta e uma linha de
 * colunas fixas, e uma coluna nova pediria migracao. Comeca desligada.
 */

function subscribeOption(onChange: () => void): () => void {
  window.addEventListener(GUIDE_OPTION_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(GUIDE_OPTION_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readOption(): boolean {
  try {
    return localStorage.getItem(GUIDE_OPTION_KEY) === "1";
  } catch {
    return false;
  }
}

export function useGuideOption(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribeOption, readOption, () => false);
  const set = useCallback((value: boolean) => {
    try {
      if (value) localStorage.setItem(GUIDE_OPTION_KEY, "1");
      else localStorage.removeItem(GUIDE_OPTION_KEY);
    } catch {
      // Sem armazenamento a opcao so nao fica guardada.
    }
    window.dispatchEvent(new Event(GUIDE_OPTION_EVENT));
  }, []);
  return [enabled, set];
}

/** A opcao, na folha de navegacao, ao lado do sumario. */
export function GuideOption({ hasSections }: { hasSections: boolean }) {
  const [enabled, setEnabled] = useGuideOption();
  return (
    <label className="flex min-h-11 items-start gap-3 text-sm" data-testid="perguntas-guia-opcao">
      <input
        type="checkbox"
        className="mt-0.5 size-5 accent-[var(--color-accent)]"
        checked={hasSections && enabled}
        disabled={!hasSections}
        onChange={(event) => setEnabled(event.target.checked)}
      />
      <span className={hasSections ? "" : "text-faint"}>
        Perguntas-guia
        <span className="block text-faint">
          {hasSections
            ? "Antes de cada seção, até 3 perguntas para ler procurando as respostas. Ligada, a seção inteira é enviada ao serviço de IA antes de você lê-la."
            : NO_SECTIONS}
        </span>
      </span>
    </label>
  );
}

type Load =
  | { state: "lendo" }
  | { state: "pronto"; questions: GuideQuestion[] }
  | { state: "erro"; message: string }
  | { state: "consentimento"; consent: "pending" | "off" };

/**
 * Mostra as perguntas ao chegar ao inicio de uma secao, com a leitura
 * pausada (a folha aberta entra no `sheetOpen` do leitor). Na secao seguinte,
 * as perguntas da anterior voltam com "Ver no texto".
 */
export function GuideQuestions({
  textId,
  paragraphs,
  total,
  index,
  onOpenChange,
  onGo,
}: {
  textId: string;
  paragraphs: Paragraph[];
  total: number;
  index: number;
  onOpenChange: (open: boolean) => void;
  onGo: (position: number) => void;
}) {
  const [enabled] = useGuideOption();
  const hasHeadings = useMemo(() => navigationHeadings(paragraphs, []).length > 0, [paragraphs]);
  const [stored, setStored] = useState<Section[]>([]);
  const sections = useMemo(
    () => sectionRanges(navigationHeadings(paragraphs, stored), total),
    [paragraphs, stored, total]
  );
  const current = sectionIndexAt(sections, index);

  // Secoes aplicadas (US-153), so quando o texto nao tem titulos.
  useEffect(() => {
    if (!enabled || hasHeadings) return;
    let active = true;
    void apiGet<{ sections: Section[] }>(`/api/texts/${textId}/secoes`)
      .then((data) => {
        if (active) setStored(data.sections);
      })
      .catch(() => {
        // Sem secoes, nao ha perguntas.
      });
    return () => {
      active = false;
    };
  }, [enabled, hasHeadings, textId]);

  const [open, setOpen] = useState<number | null>(null);
  const [loads, setLoads] = useState<Record<number, Load>>({});
  const previousRef = useRef<number | null>(null);

  const load = useCallback(
    async (start: number, cachedOnly: boolean) => {
      if (!cachedOnly) setLoads((all) => ({ ...all, [start]: { state: "lendo" } }));
      try {
        const data = await apiSend<{ questions: GuideQuestion[] }>(`/api/texts/${textId}/guia`, "POST", {
          section: start,
          cachedOnly,
        });
        setLoads((all) => ({ ...all, [start]: { state: "pronto", questions: data.questions } }));
      } catch (cause) {
        if (cachedOnly) return;
        const consent = consentFrom(cause);
        setLoads((all) => ({
          ...all,
          [start]: consent
            ? { state: "consentimento", consent }
            : {
                state: "erro",
                message: cause instanceof ApiError ? cause.message : "Não consegui preparar as perguntas.",
              },
        }));
      }
    },
    [textId]
  );

  // Entrou numa secao nova, andando para frente: abre a folha da secao.
  useEffect(() => {
    // Desligada (ou ainda sem secoes), nao ha secao anterior: ao ligar, so
    // abre se a leitura estiver exatamente no inicio de uma.
    if (!enabled || sections.length === 0) {
      previousRef.current = null;
      return;
    }
    const previous = previousRef.current;
    previousRef.current = current;
    if (!guideTrigger(previous, current, index, sections)) return;
    const section = sections[current]!;
    const before = sections[current - 1];
    setOpen(current);
    onOpenChange(true);
    if (!loads[section.start] || loads[section.start]!.state === "erro") void load(section.start, false);
    // As da secao anterior so voltam se ja existem: nao gera nada para tras.
    if (before && !loads[before.start]) void load(before.start, true);
    // So a mudanca de secao dispara; `index` muda a cada palavra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, enabled, sections]);

  const close = () => {
    setOpen(null);
    onOpenChange(false);
  };

  if (open === null || !sections[open]) return null;
  const section = sections[open]!;
  const before = open > 0 ? sections[open - 1] : undefined;
  const mine = loads[section.start];
  const previousLoad = before ? loads[before.start] : undefined;
  const previous = previousLoad?.state === "pronto" ? previousLoad.questions : [];

  return (
    <Sheet open onClose={close} title="Perguntas-guia">
      <div className="space-y-5" data-testid="perguntas-guia">
        {before && previous.length > 0 ? (
          <section className="space-y-2" aria-label="Seção anterior" data-testid="perguntas-anteriores">
            <h3 className="text-sm font-medium text-muted">{`Da seção anterior: ${before.title}`}</h3>
            <ul className="space-y-3">
              {previous.map((item) => (
                <li key={`${item.start}-${item.question}`} className="space-y-1">
                  <p className="leading-relaxed">{item.question}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      close();
                      onGo(item.start);
                    }}
                  >
                    Ver no texto
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="space-y-2" aria-label="Esta seção">
          <h3 className="text-sm font-medium text-muted">{section.title}</h3>
          {!mine || mine.state === "lendo" ? (
            <div className="flex items-center gap-3 py-2 text-muted">
              <Spinner className="size-5" />
              Preparando as perguntas
            </div>
          ) : mine.state === "consentimento" ? (
            mine.consent === "pending" ? (
              <AiConsentNotice onDecided={(allowed) => (allowed ? void load(section.start, false) : close())} />
            ) : (
              <AiOffNotice />
            )
          ) : mine.state === "erro" ? (
            <Alert>{mine.message}</Alert>
          ) : (
            <ol className="list-decimal space-y-2 pl-5">
              {mine.questions.map((item) => (
                <li key={item.question} className="leading-relaxed">
                  {item.question}
                </li>
              ))}
            </ol>
          )}
        </section>

        <Button size="lg" full onClick={close}>
          Começar a ler
        </Button>
      </div>
    </Sheet>
  );
}
