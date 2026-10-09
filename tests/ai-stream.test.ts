import { describe, expect, it } from "vitest";
import {
  encodeEvent,
  fieldDeltas,
  parseEvent,
  partialJsonFields,
  readEvents,
  splitEvents,
  STREAM_CONTENT_TYPE,
  type StreamEvent,
} from "@/lib/ai-stream";

describe("parseEvent", () => {
  it("le os eventos do protocolo", () => {
    expect(parseEvent('{"type":"delta","text":"Olá"}')).toEqual({ type: "delta", text: "Olá" });
    expect(parseEvent('{"type":"delta","text":"a","field":"simple"}')).toEqual({
      type: "delta",
      text: "a",
      field: "simple",
    });
    expect(parseEvent('{"type":"error","error":"x","refusal":true}')).toEqual({
      type: "error",
      error: "x",
      refusal: true,
    });
    expect(parseEvent('{"type":"done","answer":1}')).toEqual({ type: "done", answer: 1 });
  });

  it("ignora linha vazia, quebrada ou desconhecida", () => {
    expect(parseEvent("")).toBeNull();
    expect(parseEvent('{"type":"delta"')).toBeNull();
    expect(parseEvent('{"type":"delta","text":3}')).toBeNull();
    expect(parseEvent('{"type":"outro"}')).toBeNull();
    expect(parseEvent("[1]")).toBeNull();
  });
});

describe("splitEvents", () => {
  it("guarda a linha incompleta para o proximo pedaco", () => {
    const first = splitEvents('{"type":"delta","text":"A"}\n{"type":"del');
    expect(first.events).toEqual([{ type: "delta", text: "A" }]);
    expect(first.rest).toBe('{"type":"del');
    const second = splitEvents(`${first.rest}ta","text":"B"}\n`);
    expect(second.events).toEqual([{ type: "delta", text: "B" }]);
    expect(second.rest).toBe("");
  });

  it("e o inverso de encodeEvent", () => {
    const events: StreamEvent[] = [
      { type: "start", sentence: "Uma frase." },
      { type: "delta", text: "linha\ncom quebra" },
      { type: "done", ok: true },
    ];
    expect(splitEvents(events.map(encodeEvent).join("")).events).toEqual(events);
  });
});

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": STREAM_CONTENT_TYPE } });
}

describe("readEvents", () => {
  it("entrega os eventos e termina no done", async () => {
    const seen: StreamEvent[] = [];
    const result = await readEvents(
      streamOf(['{"type":"delta","te', 'xt":"A"}\n{"type":"done"}\n']),
      (event) => seen.push(event)
    );
    expect(result).toBe("done");
    expect(seen).toEqual([{ type: "delta", text: "A" }, { type: "done" }]);
  });

  it("conexao que acaba sem done e interrupcao", async () => {
    const seen: StreamEvent[] = [];
    const result = await readEvents(streamOf(['{"type":"delta","text":"A"}\n']), (event) =>
      seen.push(event)
    );
    expect(result).toBe("interrupted");
    expect(seen).toHaveLength(1);
  });

  it("le a ultima linha mesmo sem quebra no fim", async () => {
    const result = await readEvents(streamOf(['{"type":"error","error":"x"}']), () => undefined);
    expect(result).toBe("error");
  });
});

describe("partialJsonFields", () => {
  it("le os campos de texto ate onde chegaram", () => {
    expect(partialJsonFields('{"simple":"Ler rá')).toEqual({ simple: "Ler rá" });
    expect(partialJsonFields('{"simple":"A","translation":"","explanation":"B')).toEqual({
      simple: "A",
      translation: "",
      explanation: "B",
    });
    expect(partialJsonFields("")).toEqual({});
    expect(partialJsonFields('{"simp')).toEqual({});
  });

  it("decodifica escapes e nao corta um escape pela metade", () => {
    expect(partialJsonFields('{"simple":"diz \\"oi\\"\\nfim"}')).toEqual({ simple: 'diz "oi"\nfim' });
    expect(partialJsonFields('{"simple":"a\\')).toEqual({ simple: "a" });
    expect(partialJsonFields('{"simple":"\\u00e9')).toEqual({ simple: "é" });
    expect(partialJsonFields('{"simple":"\\u00')).toEqual({ simple: "" });
  });

  it("pula valores que nao sao texto", () => {
    expect(partialJsonFields('{"n": 3, "list": [1, {"a": 2}], "simple": "ok"}')).toEqual({
      simple: "ok",
    });
  });
});

describe("fieldDeltas", () => {
  it("devolve so o que e novo em cada campo", () => {
    const sent: Record<string, number> = {};
    const fields = ["simple", "explanation"];
    expect(fieldDeltas('{"simple":"Ler', sent, fields)).toEqual([{ field: "simple", text: "Ler" }]);
    expect(fieldDeltas('{"simple":"Ler rápido"', sent, fields)).toEqual([
      { field: "simple", text: " rápido" },
    ]);
    expect(fieldDeltas('{"simple":"Ler rápido","translation":"x","explanation":"Diz', sent, fields)).toEqual([
      { field: "explanation", text: "Diz" },
    ]);
    expect(fieldDeltas('{"simple":"Ler rápido","translation":"x","explanation":"Diz', sent, fields)).toEqual([]);
  });
});
