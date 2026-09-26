/**
 * Download, armazenamento e sintese das vozes baixaveis (Piper), no navegador.
 *
 * Tudo fica no Cache Storage `VOICE_CACHE`: o modelo da voz, a configuracao
 * dela e o motor (ONNX Runtime e o conversor de fonemas). O worker le dali,
 * entao depois de baixada a voz funciona sem conexao. O service worker e a
 * saida da conta preservam esse cache.
 */

import {
  configUrl,
  ENGINE_ASSETS,
  ENGINE_BYTES,
  modelUrl,
  PIPER_VOICES,
  preferenceKey,
  SIMD_PROBE,
  VOICE_CACHE,
  findVoice,
  type PiperVoice,
} from "@/lib/piper";

export interface DownloadProgress {
  loaded: number;
  total: number;
}

export interface SynthesizedAudio {
  pcm: Float32Array;
  sampleRate: number;
}

/** O navegador tem o que a voz baixavel precisa? */
export function piperSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "caches" in window &&
    typeof Worker !== "undefined" &&
    typeof WebAssembly === "object" &&
    typeof BigInt64Array !== "undefined" &&
    (typeof AudioContext !== "undefined" || "webkitAudioContext" in window)
  );
}

function hasSimd(): boolean {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

function absolute(path: string): string {
  return new URL(path, window.location.origin).toString();
}

function engineUrls(): string[] {
  const binary = hasSimd() ? ENGINE_ASSETS.simd : ENGINE_ASSETS.plain;
  return [...ENGINE_ASSETS.common, binary].map(absolute);
}

/* --- preferencia --------------------------------------------------------- */

/**
 * Voz escolhida para o idioma, ou null para a voz do sistema.
 *
 * Fica no aparelho, nao na conta: a voz baixada so existe neste navegador, e
 * a mesma conta no computador pode nao ter nenhuma.
 */
export function preferredVoice(language: string): PiperVoice | null {
  try {
    return findVoice(window.localStorage.getItem(preferenceKey(language)));
  } catch {
    return null;
  }
}

export function setPreferredVoice(language: string, voice: PiperVoice | null): void {
  try {
    if (voice) window.localStorage.setItem(preferenceKey(language), voice.id);
    else window.localStorage.removeItem(preferenceKey(language));
  } catch {
    // Sem armazenamento local a escolha vale so ate fechar a tela.
  }
}

/* --- armazenamento ------------------------------------------------------- */

export async function isDownloaded(voice: PiperVoice): Promise<boolean> {
  if (!piperSupported()) return false;
  try {
    const cache = await caches.open(VOICE_CACHE);
    const urls = [modelUrl(voice), configUrl(voice), ...engineUrls()];
    const hits = await Promise.all(urls.map((url) => cache.match(url)));
    return hits.every(Boolean);
  } catch {
    return false;
  }
}

export async function downloadedVoices(): Promise<string[]> {
  const flags = await Promise.all(PIPER_VOICES.map((voice) => isDownloaded(voice)));
  return PIPER_VOICES.filter((_, index) => flags[index]).map((voice) => voice.id);
}

/**
 * Baixa a voz e, na primeira vez, o motor.
 *
 * Cada arquivo so entra no cache depois de chegar inteiro: um download
 * interrompido nao deixa meio modelo guardado que pareca pronto.
 */
export async function downloadVoice(
  voice: PiperVoice,
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const cache = await caches.open(VOICE_CACHE);
  const wanted = [configUrl(voice), modelUrl(voice), ...engineUrls()];
  const present = await Promise.all(wanted.map((url) => cache.match(url)));
  const missing = wanted.filter((_, index) => !present[index]);

  const engineMissing = missing.some((url) => url.startsWith(window.location.origin));
  const total = (missing.includes(modelUrl(voice)) ? voice.bytes : 0) + (engineMissing ? ENGINE_BYTES : 0);

  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (estimate?.quota && estimate.usage !== undefined && estimate.quota - estimate.usage < total * 1.1) {
    throw new Error("Nao ha espaco livre suficiente no aparelho para esta voz.");
  }
  // Pede que o navegador nao apague a voz sozinho quando faltar espaco.
  await navigator.storage?.persist?.().catch(() => false);

  let loaded = 0;
  onProgress({ loaded, total });

  for (const url of missing) {
    const response = await fetch(url, { signal });
    if (!response.ok || !response.body) {
      throw new Error("O download da voz falhou. Verifique a conexao e tente de novo.");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress({ loaded: Math.min(loaded, total), total });
    }

    const type = response.headers.get("Content-Type") ?? "application/octet-stream";
    const blob = new Blob(chunks as BlobPart[], { type });
    await cache.put(url, new Response(blob, { headers: { "Content-Type": type } }));
  }

  onProgress({ loaded: total, total });
}

/** Apaga a voz; com a ultima voz, apaga tambem o motor. */
export async function removeVoice(voice: PiperVoice): Promise<void> {
  const cache = await caches.open(VOICE_CACHE);
  await Promise.all([cache.delete(modelUrl(voice)), cache.delete(configUrl(voice))]);

  const others = await downloadedVoices();
  if (others.length === 0) {
    const keys = await cache.keys();
    await Promise.all(keys.map((request) => cache.delete(request)));
  }

  for (const language of new Set(PIPER_VOICES.map((item) => item.language))) {
    if (preferredVoice(language)?.id === voice.id) setPreferredVoice(language, null);
  }
}

/* --- sintese ------------------------------------------------------------- */

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/**
 * Ponte com o worker: um pedido, uma resposta com o mesmo `id`.
 *
 * Um worker so para a aba inteira. Criar e iniciar custa segundos (motor de
 * ~30 MB e modelo de ~63 MB para compilar), entao ele sobrevive entre uma
 * narracao e outra, e trocar de texto no mesmo idioma nao recarrega a voz.
 */
class PiperEngine {
  private worker: Worker | null = null;
  private starting: Promise<void> | null = null;
  private voice: string | null = null;
  private loading: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private sequence = 0;

  private request<T>(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error("Motor de voz nao iniciado."));
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ ...message, id }, transfer);
    });
  }

  private fail(error: Error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.starting = null;
    this.voice = null;
    this.loading = null;
  }

  private start(): Promise<void> {
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const cache = await caches.open(VOICE_CACHE);
      const source =
        (await cache.match(absolute("/piper-worker.js"))) ?? (await fetch("/piper-worker.js"));
      const code = await source.text();
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));

      const worker = new Worker(url);
      worker.onmessage = (event: MessageEvent) => {
        const data = event.data as { id?: number; type: string; message?: string };
        const waiting = data.id !== undefined ? this.pending.get(data.id) : undefined;
        if (!waiting) return;
        this.pending.delete(data.id!);
        if (data.type === "error") waiting.reject(new Error(data.message ?? "Falha na voz."));
        else waiting.resolve(data);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        this.fail(new Error(event.message || "O motor de voz parou."));
      };
      this.worker = worker;

      await this.request({
        type: "init",
        origin: window.location.origin,
        cache: VOICE_CACHE,
        simd: hasSimd(),
      });
    })().catch((error: unknown) => {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    });

    return this.starting;
  }

  /** Garante motor iniciado e esta voz carregada. */
  async prepare(voice: PiperVoice): Promise<void> {
    await this.start();
    if (this.voice === voice.id && this.loading) return this.loading;

    this.voice = voice.id;
    this.loading = (async () => {
      const cache = await caches.open(VOICE_CACHE);
      const [model, config] = await Promise.all([
        cache.match(modelUrl(voice)),
        cache.match(configUrl(voice)),
      ]);
      if (!model || !config) throw new Error("A voz nao esta baixada neste aparelho.");

      const buffer = await model.arrayBuffer();
      await this.request(
        { type: "load", voice: voice.id, model: buffer, config: await config.json() },
        [buffer]
      );
    })().catch((error: unknown) => {
      this.voice = null;
      this.loading = null;
      throw error;
    });

    return this.loading;
  }

  async synthesize(text: string, rate: number): Promise<SynthesizedAudio> {
    return this.request<SynthesizedAudio>({ type: "synth", text, rate });
  }
}

let engine: PiperEngine | null = null;

export function piperEngine(): PiperEngine {
  engine ??= new PiperEngine();
  return engine;
}
