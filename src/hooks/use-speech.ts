"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pickVoice, rateFor, speechChunks, wordAtCharIndex } from "@/lib/speech";

export type SpeechState = "parada" | "falando" | "indisponivel";

interface StartOptions {
  from: number;
  wpm: number;
  words: string[];
  onWord: (index: number) => void;
  onEnd: () => void;
}

/**
 * Narracao do texto com a posicao acompanhando a fala.
 *
 * O evento de fronteira de palavra nao chega em todo navegador e em toda voz.
 * Por isso a fala e quebrada em frases curtas: quando o evento existe, a
 * posicao anda palavra a palavra; quando nao existe, ela anda a cada frase
 * terminada - que ainda e sincronia suficiente para acompanhar na tela.
 */
export function useSpeech(lang = "pt-BR") {
  const [state, setState] = useState<SpeechState>("parada");
  const [error, setError] = useState("");

  // Tudo o que a fala precisa vive aqui, escrito so dentro de `start`: a
  // narracao atravessa dezenas de eventos entre dois renders, e nenhum deles
  // pode depender de uma identidade de funcao que mudou no meio.
  const engine = useRef<{ stopped: boolean }>({ stopped: true });

  const stop = useCallback(() => {
    engine.current.stopped = true;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setState("parada");
  }, []);

  const start = useCallback(
    ({ from, wpm, words, onWord, onEnd }: StartOptions): boolean => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        setState("indisponivel");
        setError("Este navegador nao le em voz alta.");
        return false;
      }

      const voice = pickVoice(window.speechSynthesis.getVoices(), lang);
      if (!voice) {
        setState("indisponivel");
        setError(
          `Este aparelho nao tem voz instalada para ${lang}. Instale uma nas configuracoes do sistema.`
        );
        return false;
      }

      window.speechSynthesis.cancel();

      const session = { stopped: false };
      engine.current = session;

      const queue = speechChunks(words, from);
      const rate = rateFor(wpm);
      let position = 0;

      const speak = () => {
        if (session.stopped) return;

        const chunk = queue[position];
        if (!chunk) {
          setState("parada");
          onEnd();
          return;
        }

        const utterance = new SpeechSynthesisUtterance(chunk.words.join(" "));
        utterance.rate = rate;
        utterance.lang = lang;
        utterance.voice = voice as SpeechSynthesisVoice;

        utterance.onboundary = (event) => {
          if (session.stopped) return;
          if (event.name && event.name !== "word") return;
          onWord(chunk.start + wordAtCharIndex(chunk.words, event.charIndex));
        };

        utterance.onend = () => {
          if (session.stopped) return;
          position += 1;
          const next = queue[position];
          // Sem evento de palavra, a posicao anda no fim de cada frase.
          if (next) onWord(next.start);
          speak();
        };

        utterance.onerror = (event) => {
          // Cancelar e interromper sao erros esperados: e assim que a parada
          // acontece. Tratar como falha mostraria um aviso a cada pausa.
          if (session.stopped) return;
          if (event.error === "canceled" || event.error === "interrupted") return;
          setError("A narracao parou sozinha. Tente de novo.");
          setState("parada");
        };

        window.speechSynthesis.speak(utterance);
      };

      setError("");
      setState("falando");
      speak();
      return true;
    },
    [lang]
  );

  // Sair da tela no meio da fala deixaria a voz tocando em alguns sistemas.
  useEffect(() => stop, [stop]);

  return { state, error, start, stop };
}
