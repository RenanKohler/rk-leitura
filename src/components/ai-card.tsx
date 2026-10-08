"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client";
import { useSettings, useToast } from "@/components/providers";
import { Card, SectionTitle, Segmented } from "@/components/ui";

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

/**
 * Recursos de IA: a permissao de envio (US-125) e o uso do dia (US-126).
 *
 * A contagem vem dos mesmos contadores que a cota usa no servidor, entao o
 * cartao nunca diz que ainda ha consultas quando a rota ja vai recusar.
 */
export function AiCard() {
  const { settings, save } = useSettings();
  const notify = useToast();
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let active = true;
    void apiGet<Usage>("/api/ia/uso")
      .then((data) => {
        if (active) setUsage(data);
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
    const ok = await save({ aiEnabled: next === "ligados" });
    if (!ok) notify("Não foi possível salvar. Tente de novo.", "error");
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

      {settings.aiEnabled === true && usage ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted">Uso hoje</p>
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
    </Card>
  );
}
