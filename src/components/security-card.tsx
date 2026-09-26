"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Alert, Button, Card, Field, SectionTitle, Sheet } from "@/components/ui";
import { CopyIcon, DownloadIcon } from "@/components/icons";

interface Device {
  id: string;
  name: string;
  lastSeenAt: string;
  current: boolean;
}

const DATE = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/**
 * Seguranca da conta: codigos de recuperacao (US-96) e aparelhos conectados
 * (US-97).
 */
export function SecurityCard() {
  const notify = useToast();
  const [remaining, setRemaining] = useState<number | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState("");

  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiGet<{ remaining: number }>("/api/auth/codigos"),
      apiGet<{ devices: Device[] }>("/api/auth/aparelhos"),
    ])
      .then(([codeData, deviceData]) => {
        if (!active) return;
        setRemaining(codeData.remaining);
        setDevices(deviceData.devices);
      })
      .catch(() => {
        if (active) setError("Nao consegui carregar os dados de seguranca.");
      });
    return () => {
      active = false;
    };
  }, []);

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    setGenerating(true);
    setGenerateError("");
    try {
      const data = await apiSend<{ codes: string[] }>("/api/auth/codigos", "POST", { password });
      setCodes(data.codes);
      setRemaining(data.codes.length);
      setPassword("");
    } catch (cause) {
      setGenerateError(cause instanceof Error ? cause.message : "Nao consegui gerar os codigos.");
    } finally {
      setGenerating(false);
    }
  };

  const disconnect = async (device: Device) => {
    setError("");
    try {
      await apiSend(`/api/auth/aparelhos/${device.id}`, "DELETE");
      setDevices((current) => current?.filter((item) => item.id !== device.id) ?? null);
      notify(`${device.name} desconectado.`, "info");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao consegui desconectar.");
    }
  };

  const codesText = codes
    ? `Codigos de recuperacao - Leitura\nCada codigo vale uma vez.\n\n${codes.join("\n")}\n`
    : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codesText);
      notify("Codigos copiados.", "success");
    } catch {
      notify("Nao consegui copiar. Selecione e copie os codigos.", "error");
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([codesText], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "leitura-codigos-de-recuperacao.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="space-y-5 p-5">
      <SectionTitle>Seguranca</SectionTitle>
      {error ? <Alert>{error}</Alert> : null}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Codigos de recuperacao</h3>
        <p className="text-sm text-muted">
          Servem para redefinir a senha se voce esquece-la. Guarde-os fora do celular.
          {remaining !== null
            ? remaining > 0
              ? ` Voce tem ${remaining} codigo${remaining === 1 ? "" : "s"} sem usar.`
              : " Voce ainda nao tem codigos."
            : ""}
        </p>
        <Button variant="secondary" onClick={() => setAsking(true)}>
          {remaining ? "Gerar codigos novos" : "Gerar codigos"}
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Aparelhos conectados</h3>
        {devices === null ? null : devices.length === 0 ? (
          <p className="text-sm text-faint">Nenhum aparelho registrado desde a ultima entrada.</p>
        ) : (
          <ul className="space-y-1" data-testid="aparelhos">
            {devices.map((device) => (
              <li key={device.id} className="flex min-h-11 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {device.name}
                    {device.current ? <span className="ml-2 text-xs text-accent">Este aparelho</span> : null}
                  </p>
                  <p className="text-xs text-muted">
                    Ultimo acesso {DATE.format(new Date(device.lastSeenAt))}
                  </p>
                </div>
                {device.current ? null : (
                  <Button variant="ghost" size="sm" onClick={() => void disconnect(device)}>
                    Desconectar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet
        open={asking}
        onClose={() => {
          setAsking(false);
          setCodes(null);
          setGenerateError("");
        }}
        title="Codigos de recuperacao"
      >
        {codes ? (
          <div className="space-y-4">
            <Alert tone="positive">
              Estes codigos aparecem so agora. Os anteriores deixaram de valer.
            </Alert>
            <ul className="grid grid-cols-2 gap-2 font-mono text-base" data-testid="codigos">
              {codes.map((code) => (
                <li key={code} className="rounded-lg bg-surface-2 px-3 py-2 text-center">
                  {code}
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => void copy()}>
                <CopyIcon className="size-5" />
                Copiar
              </Button>
              <Button variant="secondary" onClick={download}>
                <DownloadIcon className="size-5" />
                Baixar
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={generate} className="space-y-4">
            <p className="text-sm text-muted">
              {remaining
                ? "Gerar codigos novos invalida os que voce tem. Confirme a senha."
                : "Confirme a senha para gerar os codigos."}
            </p>
            {generateError ? <Alert>{generateError}</Alert> : null}
            <Field
              label="Senha atual"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button type="submit" full loading={generating} disabled={!password}>
              Gerar
            </Button>
          </form>
        )}
      </Sheet>
    </Card>
  );
}
