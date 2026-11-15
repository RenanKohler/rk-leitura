"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AiConsentNotice } from "@/components/ai-consent";
import { Alert, Button, Card, SectionTitle, Skeleton } from "@/components/ui";
import { ChevronIcon } from "@/components/icons";
import { ApiError, apiGet, apiSend, consentFrom } from "@/lib/client";
import { ACTION_LINKS, type StoredProfile } from "@/lib/reading-profile";

/**
 * Perfil de leitura do mes (US-234), no fim das estatisticas.
 *
 * Gerado sob demanda: o cartao pergunta o estado ao abrir e mostra o perfil
 * guardado direto, ou o botao, ou o que falta. Um perfil por mes analisado;
 * o seguinte so sai no mes que vem.
 */

/** Estado vindo de GET /api/perfil-leitura. */
interface ProfileState {
  month: string;
  period: string;
  profile: StoredProfile | null;
  missing: string[];
  canGenerate: boolean;
  unavailable: string | null;
}

export const READING_PROFILE_ANCHOR = "perfil-leitura";

export function ReadingProfileCard() {
  const [state, setState] = useState<ProfileState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [step, setStep] = useState<"idle" | "loading" | "consent">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiGet<ProfileState>("/api/perfil-leitura")
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const generate = async () => {
    setStep("loading");
    setError("");
    try {
      const result = await apiSend<{ profile: StoredProfile }>("/api/perfil-leitura", "POST");
      setState((current) =>
        current ? { ...current, profile: result.profile, canGenerate: false, missing: [] } : current
      );
      setStep("idle");
    } catch (cause) {
      if (consentFrom(cause) === "pending") {
        setStep("consent");
        return;
      }
      if (cause instanceof ApiError && Array.isArray(cause.data.missing)) {
        const missing = cause.data.missing.filter((item): item is string => typeof item === "string");
        setState((current) => (current ? { ...current, missing, canGenerate: false } : current));
      } else {
        setError(cause instanceof Error ? cause.message : "Não consegui montar o perfil agora.");
      }
      setStep("idle");
    }
  };

  // "Agora nao" no aviso: o cartao fica sem o botao, como com a IA desligada.
  const declineAi = () => {
    setStep("idle");
    setState((current) =>
      current ? { ...current, canGenerate: false, unavailable: "Os recursos de IA estão desligados nesta conta." } : current
    );
  };

  return (
    <section aria-labelledby={`${READING_PROFILE_ANCHOR}-titulo`} className="space-y-3">
      <SectionTitle>
        <span id={`${READING_PROFILE_ANCHOR}-titulo`}>Perfil de leitura</span>
      </SectionTitle>
      <Card id={READING_PROFILE_ANCHOR} className="scroll-mt-20 space-y-4 p-5" as="div">
        {state === null ? (
          loadFailed ? (
            <p className="text-sm text-muted">Não consegui carregar o perfil agora.</p>
          ) : (
            <div className="space-y-2" aria-hidden="true">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )
        ) : (
          <Body
            state={state}
            step={step}
            error={error}
            onGenerate={() => void generate()}
            onConsent={(allowed) => (allowed ? void generate() : declineAi())}
          />
        )}
      </Card>
    </section>
  );
}

function Body({
  state,
  step,
  error,
  onGenerate,
  onConsent,
}: {
  state: ProfileState;
  step: "idle" | "loading" | "consent";
  error: string;
  onGenerate: () => void;
  onConsent: (allowed: boolean) => void;
}) {
  if (state.profile) return <Profile profile={state.profile} period={state.period} />;

  if (step === "consent") return <AiConsentNotice onDecided={onConsent} />;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Uma vez por mês, um resumo em linguagem simples do tipo de trecho que trava a sua leitura e do
        que treinar, a partir dos seus freios, questionários, palavras consultadas e revisões.
      </p>
      <p className="text-sm text-faint">{state.period}</p>

      {state.missing.length > 0 ? (
        <div className="space-y-1" data-testid="perfil-falta">
          <p className="text-sm font-medium">Ainda falta para o perfil deste mês:</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {state.missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : state.unavailable ? (
        <p className="text-sm text-muted" data-testid="perfil-indisponivel">
          {state.unavailable}
        </p>
      ) : null}

      {error ? <Alert>{error}</Alert> : null}

      {state.canGenerate ? (
        <Button size="lg" full loading={step === "loading"} onClick={onGenerate}>
          Gerar perfil do mês
        </Button>
      ) : null}
    </div>
  );
}

function Profile({ profile, period }: { profile: StoredProfile; period: string }) {
  return (
    <div className="space-y-4" data-testid="perfil-leitura">
      <p className="text-sm text-muted">{`${period} · ${profile.base}`}</p>
      <ol className="space-y-4">
        {profile.patterns.map((pattern, index) => {
          const link = pattern.action === "nenhuma" ? null : ACTION_LINKS[pattern.action];
          return (
            <li key={index} className="space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
              <p className="font-medium">{pattern.title}</p>
              {pattern.detail ? <p className="text-sm text-muted">{pattern.detail}</p> : null}
              <blockquote className="rounded-xl bg-surface-container px-3 py-2 text-sm">
                <span className="block text-xs text-faint">Exemplo dos seus dados</span>
                <span className="block">{pattern.example.text}</span>
                {pattern.example.source ? (
                  <span className="block text-xs text-faint">{pattern.example.source}</span>
                ) : null}
              </blockquote>
              <p className="text-sm">
                <span className="font-medium">O que fazer: </span>
                {pattern.suggestion}
              </p>
              {link ? (
                <Link
                  href={link.href}
                  className="state-layer inline-flex min-h-12 items-center gap-1 rounded-full pr-2 text-sm font-medium text-primary"
                >
                  {link.label}
                  <ChevronIcon className="size-4 -rotate-90" />
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-faint">O próximo perfil fica disponível no mês que vem.</p>
    </div>
  );
}
