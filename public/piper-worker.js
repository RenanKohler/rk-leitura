/*
 * Sintese de voz com Piper, fora da thread da tela.
 *
 * A inferencia leva de dezenas a centenas de milissegundos por frase; na
 * thread principal ela travaria o modo Foco a cada frase. Aqui ela roda em
 * paralelo e a tela so recebe o audio pronto.
 *
 * O worker e criado a partir de um blob (ver `src/lib/piper-client.ts`), entao
 * nao tem URL propria: todo arquivo que ele usa vem por `asset()`, que le a
 * copia guardada com a voz e so vai a rede quando ela nao existe. E isso que
 * deixa a narracao funcionar offline.
 *
 * Mensagens recebidas:
 *   { type: "init", id, origin, cache, simd }
 *   { type: "load", id, voice, model: ArrayBuffer, config }
 *   { type: "synth", id, text, rate }
 * Mensagens enviadas (sempre com o `id` do pedido):
 *   { type: "ready", id } | { type: "loaded", id, voice }
 *   { type: "audio", id, pcm: Float32Array, sampleRate }
 *   { type: "error", id?, message }
 */

let origin = "";
let cacheName = "";
let ready = null;
let phonemizer = null;
let session = null;
let config = null;
let voiceId = null;

// Uma sintese por vez: o ONNX Runtime nao aceita duas execucoes simultaneas
// na mesma sessao, e parar e retomar a narracao depressa deixa um pedido
// antigo ainda em curso quando chega o novo.
let line = Promise.resolve();
function serial(task) {
  const next = line.then(task, task);
  line = next.catch(() => undefined);
  return next;
}

async function asset(path) {
  const url = origin + path;
  try {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(url);
    if (hit) return hit;
  } catch {
    // Sem Cache Storage (modo privado de alguns navegadores): segue a rede.
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Falha ao carregar ${path}`);
  return response;
}

async function blobUrl(path, type) {
  const blob = await (await asset(path)).blob();
  return URL.createObjectURL(new Blob([blob], { type }));
}

async function init(simd) {
  // Os scripts entram por blob: o worker nao tem de onde resolver "/tts/...".
  importScripts(await blobUrl("/tts/ort.wasm.min.js", "text/javascript"));
  importScripts(await blobUrl("/tts/piper_phonemize.js", "text/javascript"));

  const wasmFile = simd ? "ort-wasm-simd.wasm" : "ort-wasm.wasm";
  self.ort.env.wasm.numThreads = 1;
  self.ort.env.wasm.simd = simd;
  self.ort.env.wasm.wasmPaths = { [wasmFile]: await blobUrl(`/tts/${wasmFile}`, "application/wasm") };

  const [wasm, data] = await Promise.all([
    asset("/tts/piper_phonemize.wasm").then((response) => response.arrayBuffer()),
    asset("/tts/piper_phonemize.data").then((response) => response.arrayBuffer()),
  ]);
  phonemizer = { module: await WebAssembly.compile(wasm), data };
}

/**
 * Texto em ids de fonema, pelo espeak-ng compilado em wasm.
 *
 * Uma instancia por frase: o programa foi feito para rodar uma vez e sair, e
 * chamar o `main` de novo na mesma instancia deixa estado do espeak para
 * tras. O wasm ja vem compilado e o pacote de dados e o mesmo buffer, entao
 * o custo por frase e so instanciar.
 */
async function phonemize(text, espeakVoice) {
  const ids = [];
  const runtime = await self.createPiperPhonemize({
    print: (line) => {
      try {
        const parsed = JSON.parse(line);
        if (Array.isArray(parsed.phoneme_ids)) ids.push(...parsed.phoneme_ids);
      } catch {
        // Linha que nao e resultado (aviso do espeak): ignorada.
      }
    },
    printErr: () => {},
    instantiateWasm: (imports, done) => {
      WebAssembly.instantiate(phonemizer.module, imports).then((instance) => done(instance));
      return {};
    },
    getPreloadedPackage: () => phonemizer.data,
    locateFile: (file) => file,
  });

  try {
    runtime.callMain([
      "-l",
      espeakVoice,
      "--input",
      JSON.stringify([{ text }]),
      "--espeak_data",
      "/espeak-ng-data",
    ]);
  } catch (error) {
    // O runtime sinaliza o fim do `main` lancando ExitStatus; codigo 0 e sucesso.
    if (!(error && error.name === "ExitStatus" && error.status === 0)) throw error;
  }
  return ids;
}

async function synth(text, rate) {
  const ids = await phonemize(text, config.espeak.voice);
  if (ids.length === 0) return new Float32Array(0);

  const { noise_scale, length_scale, noise_w } = config.inference;
  const ort = self.ort;
  const feeds = {
    input: new ort.Tensor("int64", BigInt64Array.from(ids, (id) => BigInt(id)), [1, ids.length]),
    input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
    // Velocidade no proprio modelo: duracao menor por fonema, sem distorcer
    // o timbre como aceleraria o audio depois de pronto.
    scales: new ort.Tensor("float32", Float32Array.from([noise_scale, length_scale / rate, noise_w]), [3]),
  };
  if (config.num_speakers > 1) {
    feeds.sid = new ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
  }

  const result = await session.run(feeds);
  return new Float32Array(result.output.data);
}

self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      origin = message.origin;
      cacheName = message.cache;
      ready = ready ?? init(message.simd);
      await ready;
      self.postMessage({ type: "ready", id: message.id });
      return;
    }

    await ready;

    if (message.type === "load") {
      await serial(async () => {
        if (voiceId === message.voice) return;
        session = await self.ort.InferenceSession.create(message.model, {
          executionProviders: ["wasm"],
        });
        config = message.config;
        voiceId = message.voice;
      });
      self.postMessage({ type: "loaded", id: message.id, voice: voiceId });
      return;
    }

    if (message.type === "synth") {
      const pcm = await serial(() => synth(message.text, message.rate));
      self.postMessage(
        { type: "audio", id: message.id, pcm, sampleRate: config.audio.sample_rate },
        [pcm.buffer]
      );
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      id: message.id,
      message: error && error.message ? error.message : String(error),
    });
  }
};
