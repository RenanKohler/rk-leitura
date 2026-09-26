/**
 * Vozes baixaveis (Piper).
 *
 * A voz do sistema varia de aparelho para aparelho e, no Android, costuma ser
 * a mais robotica. O Piper e um modelo de voz que roda no proprio navegador:
 * o leitor baixa uma vez (~63 MB por voz) e a narracao passa a funcionar com
 * a mesma voz em qualquer aparelho, inclusive sem conexao.
 *
 * Funcoes puras, testaveis sem navegador. O que toca Cache Storage e worker
 * esta em `piper-client.ts`.
 */

import { asLanguage, type Language } from "@/lib/language";

/** Origem dos modelos: o repositorio oficial de vozes do Piper. */
export const PIPER_VOICES_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

/** Cache Storage onde voz e motor ficam guardados. O service worker o preserva. */
export const VOICE_CACHE = "leitura-vozes";

export interface PiperVoice {
  id: string;
  /** Idioma do texto que esta voz le. */
  language: Language;
  name: string;
  description: string;
  /** Caminho do modelo dentro do repositorio, sem a extensao. */
  path: string;
  bytes: number;
  license: string;
}

/**
 * Catalogo curto de proposito: so vozes de qualidade media (a alta dobra o
 * tamanho e pesa demais no celular) e so com licenca livre - dados em dominio
 * publico ou CC0. Vozes com licenca nao comercial ficaram de fora.
 */
export const PIPER_VOICES: readonly PiperVoice[] = [
  {
    id: "pt_BR-faber-medium",
    language: "pt-BR",
    name: "Faber",
    description: "Portugues do Brasil",
    path: "pt/pt_BR/faber/medium/pt_BR-faber-medium",
    bytes: 63_201_294,
    license: "CC0",
  },
  {
    id: "pt_BR-cadu-medium",
    language: "pt-BR",
    name: "Cadu",
    description: "Portugues do Brasil",
    path: "pt/pt_BR/cadu/medium/pt_BR-cadu-medium",
    bytes: 62_950_044,
    license: "CC0",
  },
  {
    id: "pt_BR-jeff-medium",
    language: "pt-BR",
    name: "Jeff",
    description: "Portugues do Brasil",
    path: "pt/pt_BR/jeff/medium/pt_BR-jeff-medium",
    bytes: 62_950_044,
    license: "CC0",
  },
  {
    id: "en_US-ljspeech-medium",
    language: "en",
    name: "LJ",
    description: "Ingles americano, voz feminina",
    path: "en/en_US/ljspeech/medium/en_US-ljspeech-medium",
    bytes: 63_531_379,
    license: "Dominio publico",
  },
  {
    id: "en_US-kristin-medium",
    language: "en",
    name: "Kristin",
    description: "Ingles americano, voz feminina",
    path: "en/en_US/kristin/medium/en_US-kristin-medium",
    bytes: 63_531_379,
    license: "Dominio publico",
  },
  {
    id: "en_US-norman-medium",
    language: "en",
    name: "Norman",
    description: "Ingles americano, voz masculina",
    path: "en/en_US/norman/medium/en_US-norman-medium",
    bytes: 63_531_379,
    license: "Dominio publico",
  },
  {
    id: "en_US-john-medium",
    language: "en",
    name: "John",
    description: "Ingles americano, voz masculina",
    path: "en/en_US/john/medium/en_US-john-medium",
    bytes: 63_531_379,
    license: "Dominio publico",
  },
];

/**
 * Arquivos do motor, servidos pelo proprio app (`scripts/copy-tts-assets.mjs`).
 * Baixados junto da primeira voz e compartilhados por todas.
 */
export const ENGINE_ASSETS = {
  common: [
    "/piper-worker.js",
    "/tts/ort.wasm.min.js",
    "/tts/piper_phonemize.js",
    "/tts/piper_phonemize.wasm",
    "/tts/piper_phonemize.data",
  ],
  simd: "/tts/ort-wasm-simd.wasm",
  plain: "/tts/ort-wasm.wasm",
} as const;

/** Tamanho aproximado do motor, para a barra de progresso e o aviso de espaco. */
export const ENGINE_BYTES = 29_600_000;

export function findVoice(id: string | null | undefined): PiperVoice | null {
  return PIPER_VOICES.find((voice) => voice.id === id) ?? null;
}

export function voicesFor(language: string): PiperVoice[] {
  const code = asLanguage(language);
  return PIPER_VOICES.filter((voice) => voice.language === code);
}

export function modelUrl(voice: PiperVoice): string {
  return `${PIPER_VOICES_BASE}/${encodePath(voice.path)}.onnx`;
}

export function configUrl(voice: PiperVoice): string {
  return `${PIPER_VOICES_BASE}/${encodePath(voice.path)}.onnx.json`;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Chave, no aparelho, da voz escolhida para um idioma. */
export function preferenceKey(language: string): string {
  return `leitura:voz:${asLanguage(language)}`;
}

/** "63 MB". */
export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/**
 * Instante, em milissegundos, em que cada palavra de uma frase comeca.
 *
 * O Piper devolve o audio da frase inteira, sem dizer onde cada palavra cai.
 * A estimativa reparte a duracao pelo tamanho das palavras - o numero de
 * letras acompanha o de fonemas de perto - e da peso extra a pontuacao, onde
 * o modelo faz pausa. O erro fica dentro de uma ou duas palavras e zera a
 * cada frase, porque cada frase comeca no inicio do proprio audio.
 */
export function wordOffsets(words: string[], durationMs: number): number[] {
  if (words.length === 0) return [];

  const weights = words.map((word) => {
    const letters = word.replace(/[^\p{L}\p{N}]/gu, "").length;
    const pause = /[.!?…]["')\]»”’]*$/.test(word) ? 4 : /[,;:]["')\]»”’]*$/.test(word) ? 2 : 0;
    return Math.max(1, letters) + 1 + pause;
  });

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const offsets: number[] = [];
  let elapsed = 0;
  for (const weight of weights) {
    offsets.push(Math.round((elapsed / total) * durationMs));
    elapsed += weight;
  }
  return offsets;
}

/**
 * Suporte a SIMD no WebAssembly (modulo minimo de wasm-feature-detect).
 *
 * Decide qual dos dois binarios do motor baixar: o com SIMD e bem mais rapido
 * e roda em quase todo aparelho atual; o outro so existe para os antigos.
 */
export const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
]);
