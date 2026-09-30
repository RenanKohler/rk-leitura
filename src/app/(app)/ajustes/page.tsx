"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useSettings, useTheme, useToast, type ThemePreference } from "@/components/providers";
import { Card, SectionTitle, Segmented, Skeleton, Slider } from "@/components/ui";
import { ContrastIcon, MoonIcon, SettingsIcon, SunIcon } from "@/components/icons";
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
import { SPEED_BAND_LABELS, speedBand, speedBandWarning } from "@/lib/speed-bands";
import { effectiveRunnerWpm, RHYTHM_HINTS } from "@/lib/pacing";

/**
 * Cartoes abaixo da dobra carregam em pedacos proprios (APP-10).
 *
 * Nenhum deles aparece na primeira tela, e juntos traziam para /ajustes o
 * codigo de voz, push, feeds, seguranca e exportacao antes de a pessoa rolar
 * ate eles. O esqueleto guarda a altura aproximada para a pagina nao pular.
 *
 * `ssr: false` porque varios deles tem campo de arquivo ou botoes que so
 * funcionam depois de hidratar: renderizados no servidor, apareciam antes do
 * pedaco de codigo chegar, e uma escolha de arquivo nesse intervalo se perdia.
 */
const cardFallback = () => <Skeleton className="h-40 w-full rounded-card" />;
const VoiceCard = dynamic(() => import("@/components/voice-card").then((m) => m.VoiceCard), {
  loading: cardFallback,
  ssr: false,
});
const ReminderCard = dynamic(
  () => import("@/components/reminder-card").then((m) => m.ReminderCard),
  { loading: cardFallback, ssr: false }
);
const ExportCard = dynamic(() => import("@/components/export-card").then((m) => m.ExportCard), {
  loading: cardFallback,
  ssr: false,
});
const ReprocessCard = dynamic(
  () => import("@/components/reprocess-card").then((m) => m.ReprocessCard),
  { loading: cardFallback, ssr: false }
);
const FeedsCard = dynamic(() => import("@/components/feeds-card").then((m) => m.FeedsCard), {
  loading: cardFallback,
  ssr: false,
});
const BookmarkletCard = dynamic(
  () => import("@/components/bookmarklet-card").then((m) => m.BookmarkletCard),
  { loading: cardFallback, ssr: false }
);
const SecurityCard = dynamic(
  () => import("@/components/security-card").then((m) => m.SecurityCard),
  { loading: cardFallback, ssr: false }
);
const AccountCard = dynamic(() => import("@/components/account-card").then((m) => m.AccountCard), {
  loading: cardFallback,
  ssr: false,
});

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

/**
 * Indice do topo (APP-6). Ajustes virou uma pagina longa; sem ele, chegar a
 * Conta ou a Seus dados era rolar por todas as preferencias de leitura.
 */
const SECTIONS = [
  { id: "leitura", label: "Leitura" },
  { id: "aparencia", label: "Aparencia" },
  { id: "tipografia", label: "Tipografia" },
  { id: "voz", label: "Voz" },
  { id: "lembrete", label: "Lembrete" },
  { id: "dados", label: "Seus dados" },
  { id: "importar", label: "Importar" },
  { id: "conta", label: "Conta e seguranca" },
] as const;

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

  const band = speedBand(settings.baseWpm);
  const bandWarning = speedBandWarning(settings.baseWpm);

  return (
    <div className="space-y-6">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
        <p className="mt-1 text-sm text-muted">
          Preferencias salvas na sua conta. Treino, palavras e estatisticas ficam em{" "}
          <Link href="/voce" className="font-medium text-accent underline underline-offset-2">
            Voce
          </Link>
          .
        </p>
      </header>

      <nav aria-label="Secoes de ajustes">
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="flex min-h-11 items-center rounded-full border border-border px-3 text-sm font-medium text-muted hover:border-border-strong hover:text-ink"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="leitura">
        <Card className="space-y-6 p-5">
          <SectionTitle>Leitura</SectionTitle>
          <p className="text-sm text-muted">
            O texto abre em paginas. O play inicia o Word Runner, que mostra uma palavra por vez com
            a frase embaixo.
          </p>

          <Slider
            label="Velocidade do Word Runner"
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
          >
            {/* PROD-8: o numero sozinho nao diz que acima de 600 ja e varredura. */}
            <p className="text-sm text-muted" data-testid="faixa-velocidade">
              {`Faixa: ${SPEED_BAND_LABELS[band]}`}
            </p>
            {bandWarning ? (
              <p className="text-sm text-danger">
                {bandWarning}{" "}
                <Link href="/treino" className="font-medium underline underline-offset-2">
                  Abrir o treino
                </Link>
              </p>
            ) : null}
          </Slider>

          <Slider
            label="Intensidade do destaque"
            display={`${toPercent(settings.highlightOpacity)}%`}
            min={toPercent(MIN_HIGHLIGHT)}
            max={toPercent(MAX_HIGHLIGHT)}
            step={5}
            hint="Cor da palavra atual marcada na pagina, depois de pausar ou no guia na pagina."
            value={toPercent(settings.highlightOpacity)}
            onChange={(value) => void update({ highlightOpacity: value / 100 })}
          />

          <Choice
            label="Aceleracao no inicio"
            value={settings.warmup ? "gradual" : "direto"}
            onChange={(value) => void update({ warmup: value === "gradual" })}
            options={[
              { value: "gradual", label: "Gradual" },
              { value: "direto", label: "Direto" },
            ]}
            hint={
              settings.warmup
                ? `O Word Runner comeca a 60% do ritmo ao abrir o texto (85% depois de uma pausa curta) e chega ao total nas primeiras ${WARMUP_WORDS} palavras.`
                : "O Word Runner comeca direto na velocidade configurada."
            }
          />

          <Choice
            label="Ritmo do Word Runner"
            value={settings.adaptiveRhythm ? "dinamico" : "uniforme"}
            onChange={(value) => void update({ adaptiveRhythm: value === "dinamico" })}
            options={[
              { value: "dinamico", label: "Dinamico" },
              { value: "uniforme", label: "Uniforme" },
            ]}
            hint={RHYTHM_HINTS[settings.adaptiveRhythm ? "dinamico" : "uniforme"]}
          />

          <Choice
            label="Perguntar se o texto ainda vale"
            value={settings.askCheckpoints ? "perguntar" : "nao"}
            onChange={(value) => void update({ askCheckpoints: value === "perguntar" })}
            options={[
              { value: "nao", label: "Nao perguntar" },
              { value: "perguntar", label: "Perguntar" },
            ]}
            hint={
              settings.askCheckpoints
                ? "Em textos longos, a leitura pausa a 25, 50 e 75% e pergunta se vale continuar."
                : "A leitura segue ate o fim sem perguntar."
            }
          />

          <Choice
            label="Ao retomar depois de uma pausa"
            value={settings.resumeRewind ? "recuar" : "manter"}
            onChange={(value) => void update({ resumeRewind: value === "recuar" })}
            options={[
              { value: "recuar", label: "Voltar um pouco" },
              { value: "manter", label: "Seguir de onde parou" },
            ]}
            hint={
              settings.resumeRewind
                ? "Depois de 5 segundos parado, a leitura recomeca no inicio da frase; depois de 1 minuto, na frase anterior; depois de 10 minutos, no inicio do paragrafo."
                : "A leitura recomeca exatamente na palavra em que parou."
            }
          />

          <div className="space-y-2">
            <Choice
              label="Descanso da vista"
              value={settings.eyeRest ? "avisar" : "nao"}
              onChange={(value) => void update({ eyeRest: value === "avisar" })}
              options={[
                { value: "nao", label: "Sem aviso" },
                { value: "avisar", label: "A cada 20 min" },
              ]}
              hint={
                settings.eyeRest
                  ? "Depois de 20 minutos lendo sem parar, a leitura pausa e pede 20 segundos olhando para longe."
                  : "A leitura nao interrompe para descanso."
              }
            />
            {/* PROD-16: o motivo do padrao ligado. */}
            <p className="text-sm text-faint">
              Com o olhar fixo no Word Runner, piscamos menos e a vista resseca; a pausa compensa.
            </p>
          </div>

          <Choice
            label="Enfase no inicio das palavras"
            value={settings.wordEmphasis ? "enfase" : "normal"}
            onChange={(value) => void update({ wordEmphasis: value === "enfase" })}
            options={[
              { value: "normal", label: "Sem enfase" },
              { value: "enfase", label: "Com enfase" },
            ]}
            hint={
              settings.wordEmphasis
                ? "As primeiras letras de cada palavra ficam em negrito na pagina."
                : "O texto aparece com peso uniforme, como em um livro."
            }
          />

          <Preview
            highlightOpacity={settings.highlightOpacity}
            emphasis={settings.wordEmphasis}
          />
        </Card>
      </Section>

      <Section id="aparencia">
        <Card className="space-y-4 p-5">
          <SectionTitle>Aparencia</SectionTitle>
          <Choice
            label="Tema"
            hideLabel
            value={preference}
            onChange={changeTheme}
            options={[
              { value: "light", label: "Claro", icon: <SunIcon className="size-4" /> },
              { value: "dark", label: "Escuro", icon: <MoonIcon className="size-4" /> },
              { value: "contrast", label: "Contraste", icon: <ContrastIcon className="size-4" /> },
              { value: "system", label: "Sistema", icon: <SettingsIcon className="size-4" /> },
            ]}
            hint={
              preference === "contrast"
                ? "Alto contraste: texto e controles com contraste reforcado, e o trecho atual sublinhado."
                : preference === "system"
                  ? "Segue o sistema, inclusive o pedido de contraste aumentado."
                  : "O tema vale para todos os aparelhos em que voce entrar."
            }
          />
        </Card>
      </Section>

      <Section id="tipografia">
        <Card className="space-y-6 p-5">
          <SectionTitle>Tipografia</SectionTitle>

          <Choice
            label="Fonte"
            value={settings.fontFamily}
            onChange={(value) => void update({ fontFamily: value })}
            options={FONT_OPTIONS}
            hint={FONT_HINTS[settings.fontFamily]}
          />

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
              style={typographyVars(settings) as CSSProperties}
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
      </Section>

      <Section id="voz">
        <VoiceCard />
      </Section>

      <Section id="lembrete">
        <ReminderCard />
      </Section>

      <Section id="dados" className="space-y-6">
        <ExportCard />
        <ReprocessCard />
      </Section>

      <Section id="importar" className="space-y-6">
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
        <FeedsCard />
        <BookmarkletCard />
      </Section>

      <Section id="conta" className="space-y-6">
        <SecurityCard />
        <AccountCard />
      </Section>
    </div>
  );
}

/** Ancora de uma secao do indice; o recuo deixa o titulo visivel ao pular. */
function Section({
  id,
  className = "",
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`scroll-mt-4 ${className}`}>
      {children}
    </section>
  );
}

/** Controle segmentado com a explicacao da opcao escolhida logo abaixo. */
function Choice<T extends string>({
  hint,
  ...props
}: Parameters<typeof Segmented<T>>[0] & { hint?: string }) {
  return (
    <div className="space-y-2">
      <Segmented<T> {...props} />
      {hint ? <p className="text-sm text-faint">{hint}</p> : null}
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
