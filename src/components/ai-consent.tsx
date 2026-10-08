"use client";

import Link from "next/link";
import { useState } from "react";
import { useSettings } from "@/components/providers";
import { Button } from "@/components/ui";

/**
 * Consentimento para enviar conteudo ao servico de IA (US-125).
 *
 * A decisao vale para a conta inteira e e conferida no servidor: a rota de IA
 * responde 403 com `consent` quando a conta nao permitiu, e a folha que fez o
 * pedido mostra este aviso no lugar da resposta. Assim o aviso aparece antes
 * de qualquer envio, em qualquer funcao, sem uma segunda folha por cima.
 */
export function useAiConsent() {
  const { settings, save } = useSettings();
  const state: "on" | "off" | "pending" =
    settings.aiEnabled === true ? "on" : settings.aiEnabled === false ? "off" : "pending";
  return { state, decide: (enabled: boolean) => save({ aiEnabled: enabled }) };
}

export function AiConsentNotice({
  onDecided,
}: {
  /** Chamado depois de gravar a escolha: `true` quando a pessoa permitiu. */
  onDecided: (allowed: boolean) => void;
}) {
  const { decide } = useAiConsent();
  const [saving, setSaving] = useState<boolean | null>(null);

  const choose = async (allowed: boolean) => {
    setSaving(allowed);
    await decide(allowed);
    setSaving(null);
    onDecided(allowed);
  };

  return (
    <div className="space-y-3" data-testid="ia-consentimento">
      <p className="font-medium">
        O conteúdo usado por esta função é enviado a um serviço externo (Anthropic).
      </p>
      <p className="text-sm text-muted">
        Dependendo da função, vai a frase, o trecho já lido ou o texto. Sem permissão, nada sai do
        app, e as funções que não dependem de IA continuam valendo. A escolha vale para todas as
        funções de IA e pode ser mudada em Ajustes.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          size="lg"
          loading={saving === false}
          disabled={saving !== null}
          onClick={() => void choose(false)}
        >
          Agora não
        </Button>
        <Button
          size="lg"
          loading={saving === true}
          disabled={saving !== null}
          onClick={() => void choose(true)}
        >
          Permitir
        </Button>
      </div>
    </div>
  );
}

/** Aviso curto para quando a conta desligou os recursos de IA. */
export function AiOffNotice() {
  return (
    <p className="text-sm text-muted" data-testid="ia-desligada">
      Os recursos de IA estão desligados nesta conta.{" "}
      <Link href="/ajustes#ia" className="font-medium text-accent underline underline-offset-2">
        Ligar em Ajustes
      </Link>
    </p>
  );
}
