"use client";

import { useState } from "react";
import { useAuth, useSettings, useTheme, useToast, type ThemePreference } from "@/components/providers";
import { Button, Card, SectionTitle, Segmented, Slider } from "@/components/ui";
import { LogoutIcon, MoonIcon, SettingsIcon, SunIcon } from "@/components/icons";
import {
  MAX_CHUNK,
  MAX_WPM,
  MIN_CHUNK,
  MIN_WPM,
  estimatedMinutes,
  orpIndex,
  type ReadingMode,
} from "@/lib/reading";

const SAMPLE = "A leitura dinamica treina o olho a reconhecer palavras inteiras".split(" ");

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const { settings, save } = useSettings();
  const { preference, setPreference } = useTheme();
  const notify = useToast();
  const [signingOut, setSigningOut] = useState(false);

  const update = async (patch: Parameters<typeof save>[0]) => {
    const ok = await save(patch);
    if (!ok) notify("Nao foi possivel salvar. Tente de novo.", "error");
  };

  const changeTheme = (value: ThemePreference) => {
    setPreference(value);
    void save({ theme: value });
  };

  return (
    <div className="space-y-6">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
        <p className="mt-1 text-sm text-muted">Preferencias salvas na sua conta.</p>
      </header>

      <Card className="space-y-6 p-5">
        <SectionTitle>Leitura</SectionTitle>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted">Modo</p>
          <Segmented<ReadingMode>
            label="Modo de leitura"
            value={settings.readingMode}
            onChange={(value) => void update({ readingMode: value })}
            options={[
              { value: "rsvp", label: "Foco" },
              { value: "flow", label: "Texto corrido" },
            ]}
          />
        </div>

        <Slider
          label="Velocidade"
          display={`${settings.baseWpm} ppm`}
          min={MIN_WPM}
          max={MAX_WPM}
          step={10}
          hint={`Um artigo de 1.000 palavras leva cerca de ${estimatedMinutes(1000, settings.baseWpm)} min nesse ritmo.`}
          value={settings.baseWpm}
          onChange={(value) => void update({ baseWpm: value })}
        />

        <Slider
          label="Palavras por bloco"
          display={`${settings.wordsPerChunk}`}
          min={MIN_CHUNK}
          max={MAX_CHUNK}
          hint="Blocos maiores exigem mais campo visual; comece por 1."
          value={settings.wordsPerChunk}
          onChange={(value) => void update({ wordsPerChunk: value })}
        />

        <Preview mode={settings.readingMode} chunkSize={settings.wordsPerChunk} />
      </Card>

      <Card className="space-y-4 p-5">
        <SectionTitle>Aparencia</SectionTitle>
        <Segmented<ThemePreference>
          label="Tema"
          value={preference}
          onChange={changeTheme}
          options={[
            { value: "light", label: "Claro", icon: <SunIcon className="size-4" /> },
            { value: "dark", label: "Escuro", icon: <MoonIcon className="size-4" /> },
            { value: "system", label: "Sistema", icon: <SettingsIcon className="size-4" /> },
          ]}
        />
      </Card>

      <Card className="space-y-4 p-5">
        <SectionTitle>Conta</SectionTitle>
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent">
            {user?.name?.charAt(0).toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{user?.name}</p>
            <p className="break-anywhere text-sm text-muted">{user?.email}</p>
          </div>
        </div>
        <Button
          variant="secondary"
          full
          loading={signingOut}
          onClick={() => {
            setSigningOut(true);
            void logout();
          }}
        >
          <LogoutIcon className="size-5" />
          Sair da conta
        </Button>
      </Card>
    </div>
  );
}

/** Mostra como o texto aparece com os ajustes atuais. */
function Preview({ mode, chunkSize }: { mode: ReadingMode; chunkSize: number }) {
  const chunk = SAMPLE.slice(0, chunkSize);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted">Previa</p>
      <div className="flex min-h-24 items-center justify-center rounded-2xl bg-bg px-4 py-6 text-center">
        {mode === "rsvp" ? (
          <p className="reader-word w-full text-2xl font-semibold sm:text-3xl">
            {chunk.length === 1 ? <OrpPreview word={chunk[0]!} /> : chunk.join(" ")}
          </p>
        ) : (
          <p className="text-base leading-relaxed">
            {SAMPLE.map((word, index) => (
              <span
                key={index}
                className="flow-word"
                data-state={index < chunkSize ? "active" : index < chunkSize + 2 ? "pending" : "pending"}
              >
                {word}{" "}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

function OrpPreview({ word }: { word: string }) {
  const pivot = orpIndex(word);
  return (
    <span className="flex w-full items-baseline">
      <span className="flex-1 whitespace-pre text-right">{word.slice(0, pivot)}</span>
      <span className="orp">{word.slice(pivot, pivot + 1)}</span>
      <span className="flex-1 whitespace-pre text-left">{word.slice(pivot + 1)}</span>
    </span>
  );
}
