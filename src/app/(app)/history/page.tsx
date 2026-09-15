"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Session {
  id: string;
  textId: string;
  wpm: number;
  wordsRead: number;
  durationMs: number;
  completed: number;
  createdAt: string;
}

interface Text {
  id: string;
  title: string;
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [texts, setTexts] = useState<Text[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/reading-sessions").then(r => r.json()),
      fetch("/api/texts").then(r => r.json()),
    ]).then(([sessionsRes, textsRes]) => {
      setSessions(sessionsRes.sessions || []);
      setTexts(textsRes.texts || []);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMins = minutes % 60;
      return `${hours}h ${remainingMins}m`;
    }
    return `${minutes}m ${seconds}s`;
  };

  const getTextTitle = (textId: string) => {
    const text = texts.find(t => t.id === textId);
    return text?.title || "Unknown text";
  };

  const sessionsByDate = sessions.reduce((acc, session) => {
    const date = new Date(session.createdAt).toLocaleDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(session);
    return acc;
  }, {} as Record<string, Session[]>);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reading History</h1>
          <p className="mt-1 text-slate-500">{sessions.length} reading sessions</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="p-4 rounded-xl bg-white border border-slate-100 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg bg-slate-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 rounded bg-slate-100" />
                  <div className="h-3 w-1/2 rounded bg-slate-100" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-100 p-12 text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <h3 className="text-xl font-semibold text-slate-900">No reading history yet</h3>
          <p className="mt-2 text-slate-500 max-w-sm mx-auto">
            Start reading texts to build up your history
          </p>
          <Link
            href="/texts"
            className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium shadow-md hover:shadow-lg hover:from-indigo-700 hover:to-purple-700 transition-all"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Browse texts
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(sessionsByDate).map(([date, dateSessions]) => (
            <div key={date}>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">{date}</h2>
              <div className="space-y-2">
                {dateSessions.map((session, index) => (
                  <Link
                    key={session.id}
                    href={`/reader/${session.textId}`}
                    className="flex items-center gap-4 p-4 rounded-xl bg-white border border-slate-100 hover:shadow-md hover:border-slate-200 transition-all animate-fade-in"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    {/* Stats */}
                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <p className="text-xl font-bold text-indigo-600">{session.wpm}</p>
                        <p className="text-xs text-slate-500">WPM</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-emerald-600">{session.wordsRead.toLocaleString()}</p>
                        <p className="text-xs text-slate-500">Words</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-amber-600">{formatDuration(session.durationMs)}</p>
                        <p className="text-xs text-slate-500">Duration</p>
                      </div>
                      {session.completed === 1 && (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        </div>
                      )}
                    </div>

                    {/* Text info */}
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{getTextTitle(session.textId)}</p>
                    </div>

                    {/* Arrow */}
                    <div className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition-colors">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                      </svg>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
