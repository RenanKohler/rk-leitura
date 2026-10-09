import "server-only";

import { AiAborted, AiUnavailable } from "@/lib/ai";
import { encodeEvent, STREAM_CONTENT_TYPE, type StreamEvent } from "@/lib/ai-stream";

/**
 * Resposta NDJSON de uma chamada com streaming (US-145).
 *
 * `run` recebe `emit`, para mandar eventos ao cliente, e um sinal que aborta
 * quando o cliente desconecta (a folha fechou ou a rede caiu): a chamada ao
 * modelo e cancelada e o uso registrado e o que ja tinha sido gerado.
 *
 * Erro dentro de `run` vira evento `error`; o status HTTP ja foi enviado.
 */
export function streamResponse(
  request: Request,
  scope: string,
  run: (emit: (event: StreamEvent) => void, signal: AbortSignal) => Promise<void>
): Response {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (request.signal.aborted) controller.abort();
  request.signal.addEventListener("abort", abort);

  const stream = new ReadableStream<Uint8Array>({
    start(sink) {
      const encoder = new TextEncoder();
      const emit = (event: StreamEvent) => {
        if (controller.signal.aborted) return;
        try {
          sink.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          // Stream ja fechado pelo cliente.
        }
      };

      // Sem await: os eventos saem enquanto a chamada corre.
      void (async () => {
        try {
          await run(emit, controller.signal);
        } catch (error) {
          if (!(error instanceof AiAborted)) {
            if (!(error instanceof AiUnavailable)) console.error(`[ia] ${scope} falhou:`, error);
            emit({
              type: "error",
              error: error instanceof AiUnavailable ? error.message : "Não consegui responder agora.",
              ...(error instanceof AiUnavailable && error.refusal ? { refusal: true } : {}),
            });
          }
        } finally {
          request.signal.removeEventListener("abort", abort);
          try {
            sink.close();
          } catch {
            // Ja cancelado.
          }
        }
      })();
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": `${STREAM_CONTENT_TYPE}; charset=utf-8`,
      // Sem compressao nem buffer no caminho: cada linha sai quando e escrita.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
