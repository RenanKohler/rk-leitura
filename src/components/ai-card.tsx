"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/client";
import { useSettings, useToast } from "@/components/providers";
import { AiHistory } from "@/components/ai-history";
import { Alert, Button, Card, SectionTitle, Segmented, Sheet } from "@/components/ui";

interface QuotaRow {
  kind: string;
  label: string;
  used: number;
  limit: number;
}

type Choice = "ligados" | "desligados" | "pendente";

interface Usage {
  configured: boolean;
  consent: "on" | "off" | "pending";
  quotas: QuotaRow[];
}

/** O que a exclusao leva e o que fica (US-143). */
const DELETE_SCOPE =
  "Apaga as explicações, resumos, descrições de nomes, sinopses e sínteses guardados, e as perguntas feitas aos textos com as respostas.";
const DELETE_KEEPS =
  "As definições salvas em Palavras e as notas criadas a partir de respostas são suas e continuam guardadas.";
const DELETED = "Resultados de IA apagados.";

/**
 * Recursos de IA: a permissao de envio (US-125), o uso do dia (US-126), o
 * historico de envios (US-144) e a exclusao do que a IA gerou (US-143).
 *
 * A contagem vem dos mesmos contadores que a cota usa no servidor, entao o
 * cartao nunca diz que ainda ha consultas quando a rota ja vai recusar.
 */
export function AiCard() {
  const { settings, save } = useSettings();
  const notify = useToast();
  const [usage, setUsage] = useState<Usage | null>(null);
  // Itens guardados (resultados e perguntas); null enquanto carrega.
  const [stored, setStored] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<"apagar" | "desligar" | null>(null);
  const [alsoDelete, setAlsoDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiGet<Usage>("/api/ia/uso")
      .then((data) => {
        if (active) setUsage(data);
      })
      .catch(() => undefined);
    void apiGet<{ count: number }>("/api/ia/resultados")
      .then((data) => {
        if (active) setStored(data.count);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Sem escolha ainda, nenhuma das duas opcoes aparece marcada.
  const value: Choice =
    settings.aiEnabled === true ? "ligados" : settings.aiEnabled === false ? "desligados" : "pendente";

  const change = async (next: Choice) => {
    // Desligar passa por confirmacao, que oferece apagar o que ficou guardado.
    if (next === "desligados" && settings.aiEnabled !== false) {
      setAlsoDelete(false);
      setError("");
      setConfirming("desligar");
      return;
    }
    const ok = await save({ aiEnabled: next === "ligados" });
    if (!ok) notify("Não foi possível salvar. Tente de novo.", "error");
  };

  const close = () => {
    if (busy) return;
    setConfirming(null);
    setError("");
  };

  const deleteStored = async (): Promise<boolean> => {
    try {
      await apiSend("/api/ia/resultados", "DELETE");
      setStored(0);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível apagar. Tente de novo.");
      return false;
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    setError("");
    const ok = await deleteStored();
    setBusy(false);
    if (!ok) return;
    setConfirming(null);
    notify(DELETED, "success");
  };

  const confirmTurnOff = async () => {
    setBusy(true);
    setError("");
    const saved = await save({ aiEnabled: false });
    if (!saved) {
      setBusy(false);
      setError("Não foi possível salvar. Tente de novo.");
      return;
    }
    const deleted = alsoDelete && (stored ?? 0) > 0 ? await deleteStored() : false;
    setBusy(false);
    // Desligou, mas a exclusao falhou: a folha fica aberta com o erro.
    if (alsoDelete && (stored ?? 0) > 0 && !deleted) return;
    setConfirming(null);
    notify(deleted ? `Recursos de IA desligados. ${DELETED}` : "Recursos de IA desligados.", "success");
  };

  if (usage && !usage.configured) {
    return (
      <Card className="space-y-3 p-5">
        <SectionTitle>Recursos de IA</SectionTitle>
        <p className="text-sm text-muted" data-testid="ia-nao-configurada">
          Recursos de IA não configurados nesta instalação.
        </p>
      </Card>
    );
  }

  const nothingStored = stored === 0;

  return (
    <Card className="space-y-5 p-5">
      <SectionTitle>Recursos de IA</SectionTitle>
      <div className="space-y-2">
        <Segmented<Choice>
          label="Envio ao serviço de IA"
          value={value}
          onChange={(next) => void change(next)}
          options={[
            { value: "ligados", label: "Permitido" },
            { value: "desligados", label: "Desligado" },
          ]}
        />
        <p className="text-sm text-faint">
          {settings.aiEnabled === true
            ? "Dicionário, questionário, explicações, perguntas e resumos enviam o trecho necessário a um serviço externo (Anthropic)."
            : settings.aiEnabled === false
              ? "Nada sai do app. Lacunas, palavras sem definição e a recapitulação continuam valendo."
              : "Ainda sem escolha: o app pergunta na primeira vez que uma função de IA for usada."}
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted">Uso de IA</p>
        {settings.aiEnabled === true && usage ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">Uso hoje</p>
            <ul className="divide-y divide-border text-sm" data-testid="ia-uso">
              {usage.quotas.map((quota) => (
                <li key={quota.kind} className="flex items-center justify-between gap-3 py-2">
                  <span>{quota.label}</span>
                  <span className="tabular text-muted">
                    {quota.used >= quota.limit
                      ? "Limite atingido. Volta a valer às 00:00."
                      : `${quota.used} de ${quota.limit}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <AiHistory />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-muted">Resultados guardados</p>
        <p className="text-sm text-faint">
          Explicações, resumos, sinopses, sínteses e perguntas ficam guardados para reabrir sem
          gastar cota.
        </p>
        <Button
          variant="danger"
          full
          disabled={stored === null || nothingStored}
          onClick={() => {
            setError("");
            setConfirming("apagar");
          }}
        >
          {nothingStored ? "Nada guardado." : "Apagar o que a IA gerou"}
        </Button>
      </div>

      <Sheet open={confirming === "apagar"} title="Apagar o que a IA gerou" onClose={close}>
        <div className="space-y-4">
          <p className="text-sm text-muted">{DELETE_SCOPE}</p>
          <p className="text-sm text-muted">{DELETE_KEEPS}</p>
          <p className="text-sm text-faint">
            Abrir de novo um resumo apagado gera outro, que conta na cota do dia.
          </p>
          {error ? <Alert>{error}</Alert> : null}
          <Button variant="danger" size="lg" full loading={busy} onClick={() => void confirmDelete()}>
            Apagar
          </Button>
        </div>
      </Sheet>

      <Sheet open={confirming === "desligar"} title="Desligar os recursos de IA" onClose={close}>
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Nada mais sai do app. Lacunas, palavras sem definição e a recapitulação continuam
            valendo.
          </p>
          {(stored ?? 0) > 0 ? (
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-5 accent-[var(--color-accent)]"
                checked={alsoDelete}
                onChange={(event) => setAlsoDelete(event.target.checked)}
              />
              <span>
                Apagar também o que a IA gerou
                <span className="block text-faint">
                  {DELETE_SCOPE} {DELETE_KEEPS}
                </span>
              </span>
            </label>
          ) : null}
          {error ? <Alert>{error}</Alert> : null}
          <Button size="lg" full loading={busy} onClick={() => void confirmTurnOff()}>
            Desligar
          </Button>
        </div>
      </Sheet>
    </Card>
  );
}
