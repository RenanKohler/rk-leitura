"use client";

import Link from "next/link";
import { useSettings, useTheme, useToast, type ThemePreference } from "@/components/providers";
import { Button, Card, SectionTitle, Segmented, Slider } from "@/components/ui";
import { AccountCard } from "@/components/account-card";
import { ExportCard } from "@/components/export-card";
import { BookmarkletCard } from "@/components/bookmarklet-card";
import { MoonIcon, SettingsIcon, SpeedIcon, SunIcon } from "@/components/icons";
import {
  MAX_CHUNK,
  MAX_FONT_SCALE,
  MAX_HIGHLIGHT,
  MAX_LINE_HEIGHT,
  MAX_WPM,
  MIN_CHUNK,
  MIN_FONT_SCALE,
  MIN_HIGHLIGHT,
  MIN_LINE_HEIGHT,
  MIN_WPM,
  estimatedMinutes,
  orpIndex,
  typographyVars,
  WARMUP_WORDS,
  type FontFamily,
  type ReadingMode,
} from "@/lib/reading";

const SAMPLE = "A leitura dinamica treina o olho a reconhecer palavras inteiras".split(" ");

/** O slider trabalha em pontos percentuais inteiros; o valor guardado e a fracao. */
const toPercent = (fraction: number) => Math.round(fraction * 100);

const FONT_OPTIONS: { value: FontFamily; label: string }[] = [
  { value: "sans", label: "Sem serifa" },
  { value: "serif", label: "Com serifa" },
  { value: "legivel", label: "Legivel" },
];

const FONT_HINTS: Record<FontFamily, string> = {
  sans: "Traço uniforme, o padrão em tela.",
  serif: "Remates nas pontas das letras, como em livro impresso.",
  legivel: "Letras mais distintas entre si e com mais folga, para leitura com dislexia.",
};

const LINE_HEIGHT_LABELS = ["Compacto", "Normal", "Folgado"];

const MODE_HINTS: Record<ReadingMode, string> = {
  rsvp: "Uma palavra por vez no centro da tela, com a letra de fixacao destacada.",
  flow: "Texto corrido com rolagem, destacando o trecho atual.",
  page: "Uma tela cheia por vez, sem rolagem. Toque na metade direita para avancar e na esquerda para voltar.",
};

export default function SettingsPage() {
  const { settings, save } = useSettings();
  const { preference, setPreference } = useTheme();
  const notify = useToast();

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
              { value: "flow", label: "Rolagem" },
              { value: "page", label: "Paginas" },
            ]}
          />
          <p className="text-sm text-faint">{MODE_HINTS[settings.readingMode]}</p>
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

        <Slider
          label="Intensidade do destaque"
          display={`${toPercent(settings.highlightOpacity)}%`}
          min={toPercent(MIN_HIGHLIGHT)}
          max={toPercent(MAX_HIGHLIGHT)}
          step={5}
          hint="Vale para o trecho atual no modo Rolagem."
          value={toPercent(settings.highlightOpacity)}
          onChange={(value) => void update({ highlightOpacity: value / 100 })}
        />

        <Segmented<"gradual" | "direto">
          label="Aceleracao no inicio"
          value={settings.warmup ? "gradual" : "direto"}
          onChange={(value) => void update({ warmup: value === "gradual" })}
          options={[
            { value: "gradual", label: "Gradual" },
            { value: "direto", label: "Direto" },
          ]}
        />
        <p className="text-sm text-faint">
          {settings.warmup
            ? `A leitura comeca a 60% do ritmo e chega ao total nas primeiras ${WARMUP_WORDS} palavras.`
            : "A leitura comeca direto na velocidade configurada."}
        </p>

        <Preview
          mode={settings.readingMode}
          chunkSize={settings.wordsPerChunk}
          highlightOpacity={settings.highlightOpacity}
        />
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

      <Card className="space-y-6 p-5">
        <SectionTitle>Tipografia</SectionTitle>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted">Fonte</p>
          <Segmented<FontFamily>
            label="Familia da fonte"
            value={settings.fontFamily}
            onChange={(value) => void update({ fontFamily: value })}
            options={FONT_OPTIONS}
          />
          <p className="text-sm text-faint">{FONT_HINTS[settings.fontFamily]}</p>
        </div>

        <Slider
          label="Tamanho"
          display={`${settings.fontScale} de ${MAX_FONT_SCALE}`}
          min={MIN_FONT_SCALE}
          max={MAX_FONT_SCALE}
          value={settings.fontScale}
          onChange={(value) => void update({ fontScale: value })}
        />

        <Slider
          label="Entrelinha"
          display={LINE_HEIGHT_LABELS[settings.lineHeightStep - 1] ?? ""}
          min={MIN_LINE_HEIGHT}
          max={MAX_LINE_HEIGHT}
          value={settings.lineHeightStep}
          onChange={(value) => void update({ lineHeightStep: value })}
        />

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted">Previa</p>
          <div
            className="rounded-2xl bg-bg px-4 py-4"
            style={typographyVars(settings) as React.CSSProperties}
          >
            <div className="reader-prose">
              <p>
                A leitura dinamica treina o olho a reconhecer palavras inteiras em vez de
                soletrar.
              </p>
              <p>Ajuste ate a linha ficar confortavel de acompanhar sem apertar os olhos.</p>
            </div>
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <SectionTitle>Treino</SectionTitle>
        <p className="text-sm text-muted">
          Meca sua velocidade em um teste curto, ou siga um programa progressivo de 14 ou 30
          dias.
        </p>
        <Link href="/treino" className="block">
          <Button variant="secondary" size="lg" full>
            <SpeedIcon className="size-5" />
            Abrir o treino
          </Button>
        </Link>
      </Card>

      <ExportCard />

      <Card className="space-y-3 p-5">
        <SectionTitle>Compartilhar do navegador</SectionTitle>
        <p className="text-sm text-muted">
          Com o app instalado na tela inicial, Leitura passa a aparecer na lista de
          compartilhamento do celular. No navegador, toque em Compartilhar, escolha Leitura e o
          texto entra na biblioteca ja aberto no leitor.
        </p>
        <p className="text-sm text-muted">
          No Chrome do Android: menu de tres pontos, &ldquo;Adicionar a tela inicial&rdquo;.
        </p>
      </Card>

      <BookmarkletCard />

      <AccountCard />
    </div>
  );
}

/** Mostra como o texto aparece com os ajustes atuais. */
function Preview({
  mode,
  chunkSize,
  highlightOpacity,
}: {
  mode: ReadingMode;
  chunkSize: number;
  highlightOpacity: number;
}) {
  const chunk = SAMPLE.slice(0, chunkSize);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted">Previa</p>
      <div
        className="flex min-h-24 items-center justify-center rounded-2xl bg-bg px-4 py-6 text-center"
        // Mesma variavel que o leitor define: a previa mostra o destaque de
        // verdade, nao uma imitacao que sai do lugar na primeira mudanca.
        style={{ "--highlight-opacity": highlightOpacity } as React.CSSProperties}
      >
        {mode === "page" ? (
          <div className="w-full max-w-xs">
            <div className="rounded-lg border border-border bg-surface px-3 py-3 text-left">
              <p className="text-sm leading-relaxed">{SAMPLE.join(" ")}</p>
            </div>
            <p className="tabular mt-2 text-xs text-muted">Pagina 1 de 8</p>
          </div>
        ) : mode === "rsvp" ? (
          <p className="reader-word w-full text-2xl font-semibold sm:text-3xl">
            {chunk.length === 1 ? <OrpPreview word={chunk[0]!} /> : chunk.join(" ")}
          </p>
        ) : (
          <p className="text-base leading-relaxed">
            {SAMPLE.map((word, index) => (
              <span
                key={index}
                className="flow-word"
                data-state={index < chunkSize ? "active" : "pending"}
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
