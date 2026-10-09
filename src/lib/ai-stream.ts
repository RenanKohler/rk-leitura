/**
 * Protocolo das respostas em streaming (US-145), compartilhado entre rota e
 * folha. Funcoes puras, com teste.
 *
 * A rota responde NDJSON: um objeto JSON por linha. Os eventos sao
 *
 * - `start`: dados conhecidos antes do modelo (a frase explicada, por exemplo);
 * - `delta`: um trecho de texto, opcionalmente de um campo (`field`);
 * - `done`: o resultado final validado, que substitui o que foi montado com
 *   os trechos (as citacoes so chegam aqui);
 * - `error`: a chamada falhou depois de comecar. Com `refusal`, o texto
 *   parcial deve ser descartado.
 *
 * Erros antes da chamada (consentimento, cota, validacao) continuam como JSON
 * comum, com o status HTTP de sempre.
 */

export const STREAM_CONTENT_TYPE = "application/x-ndjson";

export const INTERRUPTED = "A resposta foi interrompida.";

export type StreamEvent =
  | { type: "start"; [key: string]: unknown }
  | { type: "delta"; text: string; field?: string }
  | { type: "done"; [key: string]: unknown }
  | { type: "error"; error: string; refusal?: boolean };

/** Uma linha do protocolo, ou null quando nao e um evento conhecido. */
export function parseEvent(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  switch (event.type) {
    case "start":
    case "done":
      return event as StreamEvent;
    case "delta":
      if (typeof event.text !== "string") return null;
      return {
        type: "delta",
        text: event.text,
        ...(typeof event.field === "string" ? { field: event.field } : {}),
      };
    case "error":
      return {
        type: "error",
        error: typeof event.error === "string" ? event.error : "",
        ...(event.refusal === true ? { refusal: true } : {}),
      };
    default:
      return null;
  }
}

/**
 * Separa as linhas completas do que chegou. A ultima linha sem quebra fica
 * em `rest`, a espera do proximo pedaco.
 */
export function splitEvents(buffer: string): { events: StreamEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: StreamEvent[] = [];
  for (const line of lines) {
    const event = parseEvent(line);
    if (event) events.push(event);
  }
  return { events, rest };
}

/** Uma linha do protocolo, pronta para enviar. */
export function encodeEvent(event: StreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/** A resposta e um stream do protocolo (e nao um JSON comum, como o cache). */
export function isEventStream(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes(STREAM_CONTENT_TYPE);
}

/**
 * Le o stream e entrega cada evento. Devolve `"done"` quando chegou o
 * resultado final, `"error"` quando a rota mandou erro e `"interrupted"`
 * quando a conexao acabou antes de um dos dois.
 */
export async function readEvents(
  response: Response,
  onEvent: (event: StreamEvent) => void
): Promise<"done" | "error" | "interrupted"> {
  const reader = response.body?.getReader();
  if (!reader) return "interrupted";
  const decoder = new TextDecoder();
  let buffer = "";
  let ended: "done" | "error" | null = null;
  const handle = (events: StreamEvent[]) => {
    for (const event of events) {
      if (ended) return;
      onEvent(event);
      if (event.type === "done") ended = "done";
      if (event.type === "error") ended = "error";
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const split = splitEvents(buffer);
      buffer = split.rest;
      handle(split.events);
      if (ended) break;
    }
    if (!ended) handle(splitEvents(`${buffer}${decoder.decode()}\n`).events);
  } catch (error) {
    // Folha fechada: quem cancelou nao espera resposta.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
  } finally {
    if (ended) void reader.cancel().catch(() => undefined);
  }
  return ended ?? "interrupted";
}

/**
 * Campos de texto de um JSON ainda incompleto, como chega da saida
 * estruturada em streaming. So le valores de texto do primeiro nivel; um
 * valor cortado no meio volta ate onde chegou, sem escape pela metade.
 */
export function partialJsonFields(json: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let index = json.indexOf("{");
  if (index === -1) return fields;
  index += 1;

  const skipSpace = () => {
    while (index < json.length && /\s|,/.test(json[index]!)) index += 1;
  };

  /** Le uma string a partir da aspa; devolve o texto e se ela fechou. */
  const readString = (): { value: string; closed: boolean } => {
    index += 1; // aspa de abertura
    let value = "";
    while (index < json.length) {
      const char = json[index]!;
      if (char === '"') {
        index += 1;
        return { value, closed: true };
      }
      if (char !== "\\") {
        value += char;
        index += 1;
        continue;
      }
      const next = json[index + 1];
      if (next === undefined) break;
      if (next === "u") {
        const hex = json.slice(index + 2, index + 6);
        if (hex.length < 4) break;
        value += String.fromCharCode(Number.parseInt(hex, 16));
        index += 6;
        continue;
      }
      const escapes: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
      value += escapes[next] ?? next;
      index += 2;
    }
    return { value, closed: false };
  };

  while (index < json.length) {
    skipSpace();
    if (json[index] !== '"') break;
    const key = readString();
    if (!key.closed) break;
    skipSpace();
    if (json[index] !== ":") break;
    index += 1;
    skipSpace();
    if (json[index] !== '"') {
      // Valor que nao e texto: pula ate a proxima virgula do primeiro nivel.
      let depth = 0;
      while (index < json.length) {
        const char = json[index]!;
        if (char === "{" || char === "[") depth += 1;
        else if (char === "}" || char === "]") {
          if (depth === 0) break;
          depth -= 1;
        } else if (char === "," && depth === 0) break;
        index += 1;
      }
      continue;
    }
    const value = readString();
    fields[key.value] = value.value;
    if (!value.closed) break;
  }
  return fields;
}

/**
 * Trechos novos de cada campo desde a ultima leitura. `sent` guarda quanto de
 * cada campo ja foi repassado e e atualizado aqui.
 */
export function fieldDeltas(
  json: string,
  sent: Record<string, number>,
  fields: readonly string[]
): { field: string; text: string }[] {
  const current = partialJsonFields(json);
  const deltas: { field: string; text: string }[] = [];
  for (const field of fields) {
    const value = current[field];
    if (value === undefined) continue;
    const from = sent[field] ?? 0;
    if (value.length <= from) continue;
    deltas.push({ field, text: value.slice(from) });
    sent[field] = value.length;
  }
  return deltas;
}
