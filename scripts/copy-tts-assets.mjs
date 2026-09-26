/**
 * Copia para `public/tts` os arquivos que a voz baixavel (Piper) usa no
 * navegador: o motor ONNX e o conversor de texto em fonemas.
 *
 * Servidos pelo proprio app, e nao por CDN, eles passam pelo service worker
 * e ficam guardados junto da voz - sem isso a narracao offline pararia no
 * primeiro arquivo que viesse de fora.
 *
 * Roda no `postinstall`, entao a Vercel e a CI geram a pasta sozinhas.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "public", "tts");

const FILES = [
  ["node_modules/onnxruntime-web/dist/ort.wasm.min.js", "ort.wasm.min.js"],
  ["node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm", "ort-wasm-simd.wasm"],
  ["node_modules/onnxruntime-web/dist/ort-wasm.wasm", "ort-wasm.wasm"],
  ["node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.js", "piper_phonemize.js"],
  ["node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm", "piper_phonemize.wasm"],
  ["node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data", "piper_phonemize.data"],
];

mkdirSync(target, { recursive: true });

for (const [from, to] of FILES) {
  const source = join(root, from);
  if (!existsSync(source)) {
    // Instalacao parcial (ex.: `npm ci --omit=optional` em outra ferramenta)
    // nao pode derrubar o install inteiro: a voz do sistema continua valendo.
    console.warn(`[tts] arquivo ausente, voz baixavel indisponivel: ${from}`);
    continue;
  }
  copyFileSync(source, join(target, to));
}
