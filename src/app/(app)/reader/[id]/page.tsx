"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "@/components/providers";
import Link from "next/link";

interface WordItem {
  id: string;
  word: string;
  index: number;
  startTime: number;
  endTime: number;
  isKnown: number;
}

interface TextData {
  id: string;
  title: string;
  sourceUrl: string;
  content: string;
  wordCount: number;
}

interface SessionData {
  id: string;
  wpm: number;
  wordsRead: number;
  durationMs: number;
  completed: number;
  createdAt: string;
}

export default function ReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = useAuth();
  const [text, setText] = useState<TextData | null>(null);
  const [words, setWords] = useState<WordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionData | null>(null);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timer, setTimer] = useState(0);
  const [speed, setSpeed] = useState(350);
  const [wordsPerChunk, setWordsPerChunk] = useState(4);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const resolveParams = async () => {
    const { id } = await params;
    return id;
  };

  useEffect(() => {
    resolveParams().then(async (id) => {
      try {
        const [textRes, wordsRes] = await Promise.all([
          fetch(`/api/texts/${id}`).then(r => r.json()),
          fetch(`/api/words?textId=${id}`).then(r => r.json()),
        ]);

        if (textRes.text) {
          setText(textRes.text);
        }

        if (wordsRes.words) {
          setWords(wordsRes.words);
        }
      } catch {
        // handle error
      } finally {
        setLoading(false);
      }
    });
  }, [params]);

  const startReading = useCallback(() => {
    if (words.length === 0) return;

    setIsPlaying(true);
    setTimer(0);
    setSessionStart(Date.now());

    intervalRef.current = setInterval(() => {
      setTimer((t) => t + 1000);
    }, 1000);

    // Start reading through words
    let currentIndex = currentWordIndex;
    const chunkDuration = (60 / speed) * 1000; // ms per word
    const chunkInterval = chunkDuration / wordsPerChunk;

    timerRef.current = setInterval(() => {
      if (currentIndex >= words.length) {
        setIsPlaying(false);
        clearInterval(intervalRef.current!);
        clearInterval(timerRef.current!);
        endSession(words.length - currentWordIndex);
        return;
      }

      setCurrentWordIndex(currentIndex);
      currentIndex += wordsPerChunk;
    }, chunkInterval);
  }, [words, speed, wordsPerChunk, currentWordIndex]);

  const endSession = async (wordsRead: number) => {
    if (wordsRead < 10) return;

    const duration = Date.now() - (sessionStart || Date.now() - timer * 1000);
    const wpm = Math.round((wordsRead / (duration / 60000)));

    try {
      await fetch("/api/reading-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          textId: text?.id,
          wpm,
          wordsRead,
          durationMs: duration,
          completed: 1,
        }),
      });

      setSession({
        id: "",
        wpm,
        wordsRead,
        durationMs: duration,
        completed: 1,
        createdAt: new Date().toISOString(),
      });
    } catch {
      // handle error
    }
  };

  const stopReading = useCallback(() => {
    setIsPlaying(false);
    clearInterval(intervalRef.current!);
    clearInterval(timerRef.current!);

    const wordsRead = currentWordIndex;
    if (wordsRead > 0) {
      endSession(wordsRead);
    }
  }, [currentWordIndex]);

  const skipToWord = (index: number) => {
    setCurrentWordIndex(index);
    if (isPlaying) {
      setIsPlaying(false);
      clearInterval(intervalRef.current!);
      clearInterval(timerRef.current!);
      startReading();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-full border-4 border-slate-200 border-t-indigo-600 animate-spin" />
          <p className="text-sm text-slate-500">Loading text...</p>
        </div>
      </div>
    );
  }

  if (!text) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-500 mb-4">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-slate-900">Text not found</h2>
        <p className="mt-2 text-slate-500">This text may have been deleted</p>
        <Link
          href="/texts"
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to texts
        </Link>
      </div>
    );
  }

  const visibleWords = words.slice(Math.max(0, currentWordIndex - 50), currentWordIndex + 200);
  const progress = text.wordCount > 0 ? ((currentWordIndex) / text.wordCount) * 100 : 0;

  return (
    <div className="min-h-[80vh] bg-white rounded-2xl border border-slate-100 shadow-sm animate-fade-in">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white/95 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <Link
            href="/texts"
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back
          </Link>
          <div className="hidden sm:block w-px h-6 bg-slate-200" />
          <div className="hidden sm:block">
            <h1 className="text-base font-semibold text-slate-900 line-clamp-1">{text.title}</h1>
            <p className="text-xs text-slate-500 truncate max-w-xs">{text.sourceUrl}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isPlaying ? (
            <button
              onClick={startReading}
              disabled={words.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium shadow-md hover:shadow-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 transition-all"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.368a1.125 1.125 0 010 1.972l-11.54 6.368a1.125 1.125 0 01-1.667-.986V5.653z" />
              </svg>
              Start Reading
            </button>
          ) : (
            <button
              onClick={stopReading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-300 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v10.5A2.25 2.25 0 0116.5 20.25h-9a2.25 2.25 0 01-2.25-2.25V7.5z" />
              </svg>
              Stop
            </button>
          )}

          <div className="flex items-center gap-2 ml-2">
            <span className="text-sm text-slate-500">{formatTime(timer)}</span>
            <div className="flex-1 max-w-32 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Reading Area */}
      {words.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400 mb-4">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.962 8.962 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.962 8.962 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.962 8.962 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <p className="text-slate-500">No words to display</p>
        </div>
      ) : (
        <div className="px-6 py-8 overflow-y-auto">
          <div className="max-w-3xl mx-auto">
            <div className="prose prose-slate max-w-none text-slate-900 text-lg leading-relaxed">
              {visibleWords.map((word, idx) => {
                const globalIndex = currentWordIndex - 50 + idx;
                const isActive = globalIndex >= currentWordIndex && globalIndex < currentWordIndex + wordsPerChunk * 2;
                const isPassed = globalIndex < currentWordIndex;
                const isKnown = word.isKnown === 1;

                return (
                  <span
                    key={word.id}
                    className={`cursor-pointer transition-all ${
                      isActive
                        ? "word-highlight active"
                        : isPassed
                        ? "word-highlight"
                        : isKnown
                        ? "word-highlight known"
                        : ""
                    } ${!isActive && !isPassed ? "text-slate-800" : ""}`}
                    onClick={() => skipToWord(globalIndex)}
                    style={{
                      fontSize: isActive ? "1.125rem" : "1.0625rem",
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    {word.word}
                    {idx < visibleWords.length - 1 && " "}
                  </span>
                );
              })}
            </div>

            {currentWordIndex >= words.length && (
              <div className="mt-12 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 mx-auto mb-4">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold text-slate-900">Reading Complete!</h2>
                <p className="mt-2 text-slate-500">You read {text.wordCount.toLocaleString()} words</p>
                {session && (
                  <div className="mt-6 flex items-center justify-center gap-8">
                    <div className="text-center">
                      <p className="text-3xl font-bold text-indigo-600">{session.wpm}</p>
                      <p className="text-sm text-slate-500">WPM</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold text-emerald-600">{session.wordsRead.toLocaleString()}</p>
                      <p className="text-sm text-slate-500">Words</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold text-amber-600">{formatTime(Math.floor(session.durationMs / 1000))}</p>
                      <p className="text-sm text-slate-500">Duration</p>
                    </div>
                  </div>
                )}
                <div className="mt-8 flex gap-3 justify-center">
                  <Link
                    href="/texts"
                    className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors"
                  >
                    Back to library
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Progress bar at bottom */}
      {words.length > 0 && currentWordIndex < words.length && (
        <div className="fixed bottom-0 left-0 right-0 z-20 bg-white/95 backdrop-blur-sm border-t border-slate-100 px-6 py-3">
          <div className="max-w-3xl mx-auto flex items-center justify-between text-sm">
            <span className="text-slate-500">
              Word {Math.min(currentWordIndex + 1, words.length)} of {words.length.toLocaleString()}
            </span>
            <span className="text-slate-500">{Math.round(progress)}%</span>
          </div>
          <div className="max-w-3xl mx-auto mt-1 h-1 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
