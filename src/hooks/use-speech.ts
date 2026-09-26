"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { languageName, speechLanguage } from "@/lib/language";
import { pickVoice, rateFor, speechChunks, wordAtCharIndex } from "@/lib/speech";
import { wordOffsets, type PiperVoice } from "@/lib/piper";
import {
  isDownloaded,
  piperEngine,
  piperSupported,
  preferredVoice,
  type SynthesizedAudio,
} from "@/lib/piper-client";

export type SpeechState = "parada" | "falando" | "indisponivel";

interface Session {
  stopped: boolean;
  /** Interrompe o audio em curso da voz baixada. */
  halt?: () => void;
}

let audioContext: AudioContext | null = null;

/**
 * Contexto de audio unico, criado e retomado dentro do toque do leitor: o
 * iPhone so libera som de Web Audio que comecou em um gesto.
 */
function sharedAudioContext(): AudioContext {
  if (!audioContext) {
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioContext = new Context();
  }
  // Sem isto, o iPhone no modo silencioso cala o Web Audio (Safari 16.4+).
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) session.type = "playback";
  void audioContext.resume();
  return audioContext;
}

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
 *
 * `language` e o idioma do texto (US-68): a voz escolhida e a desse idioma, e
 * sem voz instalada para ele a narracao nao comeca com a voz de outro.
 */
export function useSpeech(language = "pt-BR") {
  const lang = speechLanguage(language);
  const [state, setState] = useState<SpeechState>("parada");
  const [error, setError] = useState("");

  // Tudo o que a fala precisa vive aqui, escrito so dentro de `start`: a
  // narracao atravessa dezenas de eventos entre dois renders, e nenhum deles
  // pode depender de uma identidade de funcao que mudou no meio.
  const engine = useRef<Session>({ stopped: true });

  // Voz baixada escolhida para o idioma e ja presente no aparelho. Resolvida
  // antes do toque: `start` precisa decidir de forma sincrona, dentro do
  // gesto, ou o iPhone nao deixa o audio comecar.
  const piperRef = useRef<PiperVoice | null>(null);
  useEffect(() => {
    let active = true;
    piperRef.current = null;
    if (!piperSupported()) return;
    const voice = preferredVoice(language);
    if (!voice) return;
    void isDownloaded(voice).then((present) => {
      if (!active || !present) return;
      piperRef.current = voice;
      // Aquece o motor enquanto o leitor ainda nao pediu a narracao: a
      // primeira carga leva alguns segundos.
      void piperEngine().prepare(voice).catch(() => undefined);
    });
    return () => {
      active = false;
    };
  }, [language]);

  const stop = useCallback(() => {
    engine.current.stopped = true;
    engine.current.halt?.();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setState("parada");
  }, []);

  /**
   * Narracao com a voz baixada.
   *
   * Cada frase e sintetizada inteira no worker e tocada como um trecho de
   * audio; enquanto uma toca, a seguinte ja esta sendo gerada, para nao haver
   * silencio entre elas. A posicao anda por estimativa dentro da frase
   * (`wordOffsets`) e volta a ser exata no inicio de cada frase.
   */
  const startPiper = useCallback(
    (voice: PiperVoice, { from, wpm, words, onWord, onEnd }: StartOptions) => {
      engine.current.stopped = true;
      engine.current.halt?.();

      const session: Session = { stopped: false };
      engine.current = session;

      const context = sharedAudioContext();
      const queue = speechChunks(words, from);
      const rate = rateFor(wpm);
      const tts = piperEngine();
      const ready = tts.prepare(voice);
      const audio = new Map<number, Promise<SynthesizedAudio>>();

      const synth = (position: number) => {
        const chunk = queue[position];
        if (!chunk || audio.has(position)) return;
        const pending = ready.then(() => tts.synthesize(chunk.words.join(" "), rate));
        // Evita aviso de promessa rejeitada sem tratamento: o erro e lido em `play`.
        pending.catch(() => undefined);
        audio.set(position, pending);
      };

      const fail = () => {
        if (session.stopped) return;
        session.stopped = true;
        setError("A voz baixada falhou. Escolha a voz do aparelho em Ajustes ou baixe a voz de novo.");
        setState("parada");
      };

      const play = async (position: number) => {
        if (session.stopped) return;
        const chunk = queue[position];
        if (!chunk) {
          setState("parada");
          onEnd();
          return;
        }

        synth(position);
        let result: SynthesizedAudio;
        try {
          result = await audio.get(position)!;
        } catch {
          fail();
          return;
        }
        audio.delete(position);
        if (session.stopped) return;
        synth(position + 1);

        if (result.pcm.length === 0) {
          void play(position + 1);
          return;
        }

        const buffer = context.createBuffer(1, result.pcm.length, result.sampleRate);
        buffer.getChannelData(0).set(result.pcm);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);

        const timers = wordOffsets(chunk.words, buffer.duration * 1000).map((offset, word) =>
          window.setTimeout(() => {
            if (!session.stopped) onWord(chunk.start + word);
          }, offset)
        );

        session.halt = () => {
          source.onended = null;
          timers.forEach((timer) => window.clearTimeout(timer));
          try {
            source.stop();
          } catch {
            // Ja tinha parado.
          }
        };
        source.onended = () => {
          timers.forEach((timer) => window.clearTimeout(timer));
          void play(position + 1);
        };
        source.start();
      };

      setError("");
      setState("falando");
      void play(0);
    },
    []
  );

  const start = useCallback(
    ({ from, wpm, words, onWord, onEnd }: StartOptions): boolean => {
      const piper = piperRef.current;
      if (piper) {
        startPiper(piper, { from, wpm, words, onWord, onEnd });
        return true;
      }

      if (typeof window === "undefined" || !window.speechSynthesis) {
        setState("indisponivel");
        setError("Este navegador nao le em voz alta.");
        return false;
      }

      const voice = pickVoice(window.speechSynthesis.getVoices(), lang);
      if (!voice) {
        setState("indisponivel");
        setError(
          `Este aparelho nao tem voz instalada para ${languageName(language)}. Instale uma nas configuracoes do sistema.`
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
    [lang, language, startPiper]
  );

  // Sair da tela no meio da fala deixaria a voz tocando em alguns sistemas.
  useEffect(() => stop, [stop]);

  return { state, error, start, stop };
}
