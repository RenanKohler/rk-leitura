"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/providers";
import { Alert, Button, Card, SectionTitle } from "@/components/ui";
import { CheckIcon } from "@/components/icons";
import {
  ENGINE_BYTES,
  PIPER_VOICES,
  formatMegabytes,
  voicesFor,
  type PiperVoice,
} from "@/lib/piper";
import {
  downloadVoice,
  downloadedVoices,
  piperEngine,
  piperSupported,
  preferredVoice,
  removeVoice,
  setPreferredVoice,
} from "@/lib/piper-client";
import { speechChunks } from "@/lib/speech";

const GROUPS = [
  { language: "pt-BR", title: "Portugues", sample: "Esta e a voz que vai ler os seus textos." },
  { language: "en", title: "Ingles", sample: "This is the voice that will read your texts." },
] as const;

interface Download {
  id: string;
  percent: number;
  controller: AbortController;
}

/**
 * Vozes para baixar (Piper).
 *
 * A voz do sistema continua sendo o padrao: baixar e opcional, pesa ~63 MB
 * por voz mais ~30 MB do motor na primeira, e so vale neste aparelho.
 */
export function VoiceCard() {
  const notify = useToast();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [stored, setStored] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Record<string, string | null>>({});
  const [download, setDownload] = useState<Download | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const contextRef = useRef<AudioContext | null>(null);

  // Tudo depende do navegador: decidido depois de montar, para o HTML do
  // servidor e o do cliente serem iguais.
  useEffect(() => {
    let active = true;
    const ok = piperSupported();
    void (ok ? downloadedVoices() : Promise.resolve([])).then((list) => {
      if (!active) return;
      setSupported(ok);
      setStored(list);
      setChosen(
        Object.fromEntries(
          GROUPS.map((group) => [group.language, ok ? (preferredVoice(group.language)?.id ?? null) : null])
        )
      );
    });
    return () => {
      active = false;
    };
  }, []);

  // Sair da tela no meio do download cancela: sem isso ele seguiria gastando
  // dados moveis sem ninguem ver o progresso.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const choose = (language: string, voice: PiperVoice | null) => {
    setPreferredVoice(language, voice);
    setChosen((current) => ({ ...current, [language]: voice?.id ?? null }));
  };

  const fetchVoice = async (voice: PiperVoice) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setDownload({ id: voice.id, percent: 0, controller });
    try {
      await downloadVoice(
        voice,
        ({ loaded, total }) => {
          const percent = total > 0 ? Math.floor((loaded / total) * 100) : 0;
          setDownload((current) => (current && current.id === voice.id ? { ...current, percent } : current));
        },
        controller.signal
      );
      setStored(await downloadedVoices());
      // Quem baixa uma voz quer usa-la; a primeira do idioma ja fica escolhida.
      if (!chosen[voice.language]) choose(voice.language, voice);
      notify(`Voz ${voice.name} baixada.`, "success");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Nao consegui baixar a voz.");
    } finally {
      abortRef.current = null;
      setDownload(null);
    }
  };

  const deleteVoice = async (voice: PiperVoice) => {
    setError("");
    try {
      await removeVoice(voice);
      setStored(await downloadedVoices());
      if (chosen[voice.language] === voice.id) choose(voice.language, null);
      notify(`Voz ${voice.name} apagada.`, "info");
    } catch {
      setError("Nao consegui apagar a voz.");
    }
  };

  const test = async (voice: PiperVoice, sample: string) => {
    setError("");
    setTesting(voice.id);
    try {
      contextRef.current ??= new AudioContext();
      const context = contextRef.current;
      void context.resume();
      const engine = piperEngine();
      await engine.prepare(voice);
      const words = speechChunks(sample.split(" "), 0)[0]!.words;
      const { pcm, sampleRate } = await engine.synthesize(words.join(" "), 1);
      const buffer = context.createBuffer(1, pcm.length, sampleRate);
      buffer.getChannelData(0).set(pcm);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => setTesting(null);
      source.start();
    } catch {
      setError("Nao consegui tocar a voz. Apague e baixe de novo.");
      setTesting(null);
    }
  };

  if (supported === null) return null;

  return (
    <Card className="space-y-4 p-5">
      <SectionTitle>Vozes para baixar</SectionTitle>
      <p className="text-sm text-muted">
        Vozes que funcionam neste aparelho mesmo sem internet, iguais em qualquer celular. Cada voz
        ocupa cerca de {formatMegabytes(PIPER_VOICES[0]!.bytes)}; a primeira baixa tambem o motor
        de voz ({formatMegabytes(ENGINE_BYTES)}). Use Wi-Fi.
      </p>

      {!supported ? (
        <Alert>Este navegador nao consegue rodar as vozes baixaveis. A voz do sistema continua valendo.</Alert>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}

      {supported
        ? GROUPS.map((group) => (
            <fieldset key={group.language} className="space-y-2">
              <legend className="mb-1 text-sm font-semibold">{group.title}</legend>

              <label className="flex min-h-11 items-center gap-3 rounded-lg px-1">
                <input
                  type="radio"
                  name={`voz-${group.language}`}
                  checked={!chosen[group.language]}
                  onChange={() => choose(group.language, null)}
                  className="size-4 accent-[var(--color-accent)]"
                />
                <span className="text-sm">Voz do sistema</span>
              </label>

              {voicesFor(group.language).map((voice) => {
                const present = stored.includes(voice.id);
                const busy = download?.id === voice.id;
                return (
                  <div
                    key={voice.id}
                    data-testid={`voz-${voice.id}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-1 py-1"
                  >
                    <label className="flex min-h-11 flex-1 items-center gap-3">
                      <input
                        type="radio"
                        name={`voz-${group.language}`}
                        checked={chosen[group.language] === voice.id}
                        disabled={!present}
                        onChange={() => choose(group.language, voice)}
                        className="size-4 accent-[var(--color-accent)]"
                      />
                      <span className="text-sm">
                        <span className="font-medium">{voice.name}</span>
                        <span className="block text-xs text-muted">
                          {voice.description} · {formatMegabytes(voice.bytes)} · {voice.license}
                        </span>
                      </span>
                    </label>

                    {present ? (
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void test(voice, group.sample)}
                          loading={testing === voice.id}
                          disabled={testing !== null}
                        >
                          Ouvir
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void deleteVoice(voice)}>
                          Apagar
                        </Button>
                      </div>
                    ) : busy ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm tabular-nums text-muted" aria-live="polite">
                          {download.percent}%
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => download.controller.abort()}>
                          Cancelar
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void fetchVoice(voice)}
                        disabled={download !== null}
                      >
                        Baixar
                      </Button>
                    )}
                  </div>
                );
              })}

              {chosen[group.language] ? (
                <p className="flex items-center gap-1.5 text-xs text-muted">
                  <CheckIcon className="size-3.5" /> A narracao de textos em {group.title.toLowerCase()} usa
                  esta voz neste aparelho.
                </p>
              ) : null}
            </fieldset>
          ))
        : null}
    </Card>
  );
}
