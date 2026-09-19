"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Alert, Button, Card, SectionTitle } from "@/components/ui";
import { CheckIcon } from "@/components/icons";

interface Status {
  hour: number | null;
  devices: number;
  publicKey: string | null;
  available: boolean;
}

/** Horas oferecidas: as que fazem sentido para um lembrete de leitura. */
const HOURS = [7, 8, 9, 12, 15, 18, 19, 20, 21, 22];

/**
 * Lembrete diario.
 *
 * A permissao e pedida no toque, nunca na abertura da tela: o navegador
 * penaliza quem pede sem contexto, e uma recusa e definitiva ate a pessoa
 * mexer nas configuracoes do site.
 */
export function ReminderCard() {
  const notify = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiGet<Status>("/api/lembretes")
      .then((data) => {
        if (active) setStatus(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);


  const enable = async (hour: number) => {
    setBusy(true);
    setError("");
    try {
      if (!supported) {
        setError("Este navegador nao oferece notificacoes. No iPhone, instale o app na tela inicial primeiro.");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError(
          "A permissao foi negada. Para reativar, abra as configuracoes do site no navegador e permita notificacoes."
        );
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: status?.publicKey ?? undefined,
        }));

      await apiSend("/api/lembretes", "POST", { hour, subscription: subscription.toJSON() });
      setStatus((current) => (current ? { ...current, hour, devices: current.devices + 1 } : current));
      notify("Lembrete ativado.", "success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao consegui ativar o lembrete.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const query = subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : "";
      await subscription?.unsubscribe();
      await apiSend(`/api/lembretes${query}`, "DELETE");
      setStatus((current) => (current ? { ...current, hour: null } : current));
      notify("Lembrete desligado.", "info");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao consegui desligar.");
    } finally {
      setBusy(false);
    }
  };

  // Nada e decidido antes de o estado chegar do servidor. O suporte a
  // notificacao so existe no navegador, e testa-lo durante a renderizacao
  // faria o HTML do servidor dizer uma coisa e o cliente outra - a
  // hidratacao quebra e o React remonta a arvore inteira.
  if (!status) {
    return (
      <Card className="space-y-3 p-5">
        <SectionTitle>Lembrete diario</SectionTitle>
        <div className="h-4 w-3/4 rounded bg-surface-2" />
        <div className="h-11 w-full rounded-full bg-surface-2" />
      </Card>
    );
  }

  if (!status.available) return null;

  const supported =
    "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;

  return (
    <Card className="space-y-4 p-5">
      <SectionTitle>Lembrete diario</SectionTitle>

      <p className="text-sm text-muted">
        Um aviso a partir do horario que voce escolher, nos dias em que ainda nao leu. Se ja
        cumpriu a meta do dia, nada chega.
      </p>

      {error ? <Alert>{error}</Alert> : null}

      {!supported ? (
        <p className="text-sm text-faint">
          Este navegador nao oferece notificacoes. No iPhone, instale o app na tela inicial pela
          folha de compartilhamento do Safari.
        </p>
      ) : status.hour !== null ? (
        <>
          <p className="flex items-center gap-2 text-sm font-medium text-positive">
            <CheckIcon className="size-5" />
            {`Ativo as ${String(status.hour).padStart(2, "0")}:00`}
          </p>
          <Button variant="secondary" size="lg" full loading={busy} onClick={() => void disable()}>
            Desligar o lembrete
          </Button>
        </>
      ) : (
        <div>
          <p className="mb-2 text-sm font-medium text-muted">Escolha a hora</p>
          <div className="flex flex-wrap gap-2">
            {HOURS.map((hour) => (
              <button
                key={hour}
                type="button"
                disabled={busy}
                onClick={() => void enable(hour)}
                className="tabular flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-medium transition-colors hover:border-border-strong disabled:opacity-45"
              >
                {`${String(hour).padStart(2, "0")}:00`}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
