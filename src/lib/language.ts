/**
 * Idioma de cada texto (US-67).
 *
 * A lista e curta de proposito: sao os idiomas em que voz, dicionario e
 * questionario foram pensados para funcionar. O que a origem declarar fora
 * dela vira portugues, e a edicao do texto permite corrigir.
 */

export const LANGUAGES = [
  { code: "pt-BR", name: "Portugues" },
  { code: "en", name: "Ingles" },
  { code: "es", name: "Espanhol" },
  { code: "fr", name: "Frances" },
  { code: "it", name: "Italiano" },
  { code: "de", name: "Alemao" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

export const DEFAULT_LANGUAGE: Language = "pt-BR";

const BY_BASE: Record<string, Language> = {
  pt: "pt-BR",
  en: "en",
  es: "es",
  fr: "fr",
  it: "it",
  de: "de",
};

/**
 * Idioma declarado pela origem (`lang` do HTML, `dc:language` do EPUB) na
 * forma da lista, ou null quando nao ha correspondencia. Aceita variantes
 * regionais: `en-US` e `en_GB` viram `en`, qualquer `pt-*` vira `pt-BR`.
 */
export function normalizeLanguage(raw: unknown): Language | null {
  if (typeof raw !== "string") return null;
  const base = raw.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return BY_BASE[base] ?? null;
}

/** Como `normalizeLanguage`, com portugues quando nao ha correspondencia. */
export function asLanguage(raw: unknown): Language {
  return normalizeLanguage(raw) ?? DEFAULT_LANGUAGE;
}

export function languageName(code: string): string {
  return LANGUAGES.find((language) => language.code === code)?.name ?? "Portugues";
}

/**
 * Codigo que a sintese de voz entende. As variantes preferidas vem primeiro
 * na escolha da voz; sem elas, qualquer voz do mesmo idioma serve.
 */
export function speechLanguage(code: string): string {
  const preferred: Record<Language, string> = {
    "pt-BR": "pt-BR",
    en: "en-US",
    es: "es-ES",
    fr: "fr-FR",
    it: "it-IT",
    de: "de-DE",
  };
  return preferred[asLanguage(code)];
}
