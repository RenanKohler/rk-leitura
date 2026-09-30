"use client";

import Link from "next/link";
import { useSettings, useTheme, useToast, type ThemePreference } from "@/components/providers";
import { Button, Card, SectionTitle, Segmented, Slider } from "@/components/ui";
import { AccountCard } from "@/components/account-card";
import { ExportCard } from "@/components/export-card";
import { BookmarkletCard } from "@/components/bookmarklet-card";
import { FeedsCard } from "@/components/feeds-card";
import { ReminderCard } from "@/components/reminder-card";
import { VoiceCard } from "@/components/voice-card";
import { SecurityCard } from "@/components/security-card";
import { ReprocessCard } from "@/components/reprocess-card";
import {
  ContrastIcon,
  MoonIcon,
  SettingsIcon,
  SpeedIcon,
  SunIcon,
  WordsIcon,
} from "@/components/icons";
import {
  MAX_FONT_SCALE,
  MAX_HIGHLIGHT,
  MAX_LINE_HEIGHT,
  MAX_WPM,
  MIN_FONT_SCALE,
  MIN_HIGHLIGHT,
  MIN_LINE_HEIGHT,
  MIN_WPM,
  estimatedMinutes,
  orpIndex,
  splitEmphasis,
  typographyVars,
  WARMUP_WORDS,
  type FontFamily,
} from "@/lib/reading";
import { effectiveRunnerWpm, RHYTHM_HINTS } from "@/lib/pacing";

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

        <p className="text-sm text-faint">
          O texto abre em paginas. O play inicia o Word Runner: uma palavra por vez, com a frase
          em volta embaixo. Pausar volta a pagina, com a palavra atual marcada.
        </p>

        <Slider
          label="Velocidade"
          display={`${settings.baseWpm} ppm`}
          min={MIN_WPM}
          max={MAX_WPM}
          step={10}
          hint={
            settings.adaptiveRhythm
              ? `Um artigo de 1.000 palavras leva cerca de ${estimatedMinutes(1000, settings.baseWpm, true)} min nesse ritmo (~${effectiveRunnerWpm(settings.baseWpm)} ppm com as pausas).`
              : `Um artigo de 1.000 palavras leva cerca de ${estimatedMinutes(1000, settings.baseWpm, false)} min nesse ritmo.`
          }
          value={settings.baseWpm}
          onChange={(value) => void update({ baseWpm: value })}
        />

        <Slider
          label="Intensidade do destaque"
          display={`${toPercent(settings.highlightOpacity)}%`}
          min={toPercent(MIN_HIGHLIGHT)}
          max={toPercent(MAX_HIGHLIGHT)}
          step={5}
          hint="Vale para a palavra atual marcada na pagina."
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

        <Segmented<"dinamico" | "uniforme">
          label="Ritmo do Word Runner"
          value={settings.adaptiveRhythm ? "dinamico" : "uniforme"}
          onChange={(value) => void update({ adaptiveRhythm: value === "dinamico" })}
          options={[
            { value: "dinamico", label: "Dinamico" },
            { value: "uniforme", label: "Uniforme" },
          ]}
        />
        <p className="text-sm text-faint">
          {RHYTHM_HINTS[settings.adaptiveRhythm ? "dinamico" : "uniforme"]}
        </p>

        <Segmented<"perguntar" | "nao">
          label="Perguntar se o texto ainda vale"
          value={settings.askCheckpoints ? "perguntar" : "nao"}
          onChange={(value) => void update({ askCheckpoints: value === "perguntar" })}
          options={[
            { value: "nao", label: "Nao perguntar" },
            { value: "perguntar", label: "Perguntar" },
          ]}
        />
        <p className="text-sm text-faint">
          {settings.askCheckpoints
            ? "Em textos longos, a leitura pausa a 25, 50 e 75% e pergunta se vale continuar."
            : "A leitura segue ate o fim sem perguntar."}
        </p>

        <Segmented<"recuar" | "manter">
          label="Ao retomar depois de uma pausa"
          value={settings.resumeRewind ? "recuar" : "manter"}
          onChange={(value) => void update({ resumeRewind: value === "recuar" })}
          options={[
            { value: "recuar", label: "Voltar um pouco" },
            { value: "manter", label: "Seguir de onde parou" },
          ]}
        />
        <p className="text-sm text-faint">
          {settings.resumeRewind
            ? "Depois de 5 segundos ou mais parado, a leitura recomeca ate 5 palavras antes, sem passar do inicio da frase."
            : "A leitura recomeca exatamente na palavra em que parou."}
        </p>

        <Segmented<"avisar" | "nao">
          label="Descanso da vista"
          value={settings.eyeRest ? "avisar" : "nao"}
          onChange={(value) => void update({ eyeRest: value === "avisar" })}
          options={[
            { value: "nao", label: "Sem aviso" },
            { value: "avisar", label: "A cada 20 min" },
          ]}
        />
        <p className="text-sm text-faint">
          {settings.eyeRest
            ? "Depois de 20 minutos lendo sem parar, a leitura pausa e pede 20 segundos olhando para longe."
            : "A leitura nao interrompe para descanso."}
        </p>

        <Segmented<"normal" | "enfase">
          label="Enfase no inicio das palavras"
          value={settings.wordEmphasis ? "enfase" : "normal"}
          onChange={(value) => void update({ wordEmphasis: value === "enfase" })}
          options={[
            { value: "normal", label: "Sem enfase" },
            { value: "enfase", label: "Com enfase" },
          ]}
        />
        <p className="text-sm text-faint">
          {settings.wordEmphasis
            ? "As primeiras letras de cada palavra ficam em negrito na pagina."
            : "O texto aparece com peso uniforme, como em um livro."}
        </p>

        <Preview
          highlightOpacity={settings.highlightOpacity}
          emphasis={settings.wordEmphasis}
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
            { value: "contrast", label: "Contraste", icon: <ContrastIcon className="size-4" /> },
            { value: "system", label: "Sistema", icon: <SettingsIcon className="size-4" /> },
          ]}
        />
        {preference === "contrast" || preference === "system" ? (
          <p className="text-sm text-faint">
            {preference === "contrast"
              ? "Alto contraste: texto e controles com contraste reforcado, e o trecho atual sublinhado."
              : "Segue o sistema, inclusive o pedido de contraste aumentado."}
          </p>
        ) : null}
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

      <ReprocessCard />

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

      <Card className="space-y-3 p-5">
        <SectionTitle>Palavras</SectionTitle>
        <p className="text-sm text-muted">
          Durante a leitura, toque e segure em uma palavra para ver o significado. No modo Foco,
          pause e toque na palavra exibida.
        </p>
        <Link href="/palavras" className="block">
          <Button variant="secondary" size="lg" full>
            <WordsIcon className="size-5" />
            Palavras salvas
          </Button>
        </Link>
      </Card>

      <VoiceCard />

      <ReminderCard />

      <FeedsCard />

      <BookmarkletCard />

      <SecurityCard />

      <AccountCard />
    </div>
  );
}

/** Mostra como o texto aparece com os ajustes atuais: a pagina e o Word Runner. */
function Preview({ highlightOpacity, emphasis }: { highlightOpacity: number; emphasis: boolean }) {
  // Palavra marcada na pagina: a mesma que aparece no Word Runner ao lado.
  const current = 3;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted">Previa</p>
      <div
        className="grid gap-3 rounded-2xl bg-bg px-4 py-6 sm:grid-cols-2"
        // Mesma variavel que o leitor define: a previa mostra o destaque de
        // verdade, nao uma imitacao que sai do lugar na primeira mudanca.
        style={{ "--highlight-opacity": highlightOpacity } as React.CSSProperties}
      >
        <div className="rounded-lg border border-border bg-surface px-3 py-3 text-left">
          <p className="text-sm leading-relaxed">
            {SAMPLE.map((word, index) => (
              <span key={index}>
                {index > 0 ? " " : null}
                <span className={index === current ? "current-word" : undefined}>
                  <Emphasized word={word} on={emphasis} />
                </span>
              </span>
            ))}
          </p>
          <p className="tabular mt-2 text-xs text-muted">Pagina 1 de 8</p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface px-3 py-3 text-center">
          <p className="reader-word w-full text-2xl font-semibold">
            <OrpPreview word={SAMPLE[current]!} />
          </p>
          <p className="runner-context mt-2">
            {SAMPLE.map((word, index) => (
              <span key={index} data-current={index === current ? "" : undefined}>
                {index > 0 ? " " : null}
                {word}
              </span>
            ))}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Mesma divisao que o leitor usa, para a previa nao mentir. */
function Emphasized({ word, on }: { word: string; on: boolean }) {
  if (!on) return <>{word}</>;
  return (
    <>
      {splitEmphasis(word, true).map((part, index) =>
        part.bold ? <b key={index}>{part.text}</b> : <span key={index}>{part.text}</span>
      )}
    </>
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
