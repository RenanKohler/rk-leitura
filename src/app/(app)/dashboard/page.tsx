"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers";
import Link from "next/link";

interface DashboardStats {
  totalTexts: number;
  totalWordsRead: number;
  avgWpm: number;
  totalSessions: number;
}

interface RecentText {
  id: string;
  title: string;
  sourceUrl: string;
  wordCount: number;
  createdAt: string;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentTexts, setRecentTexts] = useState<RecentText[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/texts").then(r => r.json()),
      fetch("/api/reading-sessions").then(r => r.json()),
    ]).then(([textsRes, sessionsRes]) => {
      const textsData = textsRes.texts || [];
      const sessionsData = sessionsRes.sessions || [];

      const totalWordsRead = sessionsData.reduce((sum: number, s: any) => sum + s.wordsRead, 0);
      const avgWpm = sessionsData.length > 0
        ? Math.round(sessionsData.reduce((sum: number, s: any) => sum + s.wpm, 0) / sessionsData.length)
        : 0;

      setStats({
        totalTexts: textsData.length,
        totalWordsRead,
        avgWpm,
        totalSessions: sessionsData.length,
      });

      setRecentTexts(
        textsData.slice(0, 5).map((t: any) => ({
          id: t.id,
          title: t.title,
          sourceUrl: t.sourceUrl,
          wordCount: t.wordCount,
          createdAt: t.createdAt,
        }))
      );

      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  const handleImportUrl = async (url: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to import");
        return;
      }

      // Create the text
      const createRes = await fetch("/api/texts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const createData = await createRes.json();

      if (createRes.ok) {
        window.location.reload();
      }
    } catch (error) {
      alert("Failed to import URL");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Welcome back, {user?.name?.split(" ")[0]}
          </h1>
          <p className="mt-1 text-slate-500">Here's your reading overview</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/texts/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium shadow-md hover:shadow-lg hover:from-indigo-700 hover:to-purple-700 transition-all"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            New Text
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Total Texts",
            value: stats?.totalTexts || 0,
            icon: (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.962 8.962 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.962 8.962 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.962 8.962 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            ),
            color: "bg-indigo-50 text-indigo-600",
          },
          {
            label: "Words Read",
            value: stats?.totalWordsRead?.toLocaleString() || "0",
            icon: (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5h3m-6 10.5h15A2.25 2.25 0 0021 21v-2.25M12 3v18m0 0l-3-3m3 3l3-3" />
              </svg>
            ),
            color: "bg-emerald-50 text-emerald-600",
          },
          {
            label: "Average WPM",
            value: stats?.avgWpm || 0,
            icon: (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ),
            color: "bg-amber-50 text-amber-600",
          },
          {
            label: "Sessions",
            value: stats?.totalSessions || 0,
            icon: (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
            ),
            color: "bg-purple-50 text-purple-600",
          },
        ].map((stat, i) => (
          <div
            key={stat.label}
            className={`rounded-2xl p-5 bg-white border border-slate-100 shadow-sm hover:shadow-md transition-shadow animate-fade-in stagger-${i + 1}`}
          >
            <div className="flex items-start justify-between">
              <div className={`p-2.5 rounded-xl ${stat.color}`}>
                {stat.icon}
              </div>
            </div>
            <div className="mt-4">
              <p className="text-3xl font-bold text-slate-900">{stat.value}</p>
              <p className="mt-1 text-sm text-slate-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Import URL */}
      <div className="rounded-2xl bg-white border border-slate-100 p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-slate-900">Quick Import</h3>
            <p className="mt-1 text-sm text-slate-500">Paste a URL to import and read an article</p>
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="https://example.com/article"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const input = e.target as HTMLInputElement;
                  if (input.value.trim()) {
                    handleImportUrl(input.value.trim());
                    input.value = "";
                  }
                }
              }}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            />
            <button
              onClick={() => {
                const input = document.querySelector("input[type='url']") as HTMLInputElement;
                if (input && input.value.trim()) {
                  handleImportUrl(input.value.trim());
                  input.value = "";
                }
              }}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {saving ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Importing
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m0 0l-6.75-6.75M12 19.5l6.75-6.75" />
                  </svg>
                  Import
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Recent Texts */}
      <div className="rounded-2xl bg-white border border-slate-100 shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Recent Texts</h2>
          <Link
            href="/texts"
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
          >
            View all
          </Link>
        </div>

        {loading ? (
          <div className="px-6 py-8 space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg bg-slate-100 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-slate-100 animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-slate-100 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : recentTexts.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="flex justify-center mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.962 8.962 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.962 8.962 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.962 8.962 0 00-6 2.292m0-14.25v14.25" />
                </svg>
              </div>
            </div>
            <h3 className="text-lg font-medium text-slate-900">No texts yet</h3>
            <p className="mt-1 text-sm text-slate-500">Import your first article to get started</p>
            <Link
              href="/texts/new"
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m0 0l-6.75-6.75M12 19.5l6.75-6.75" />
              </svg>
              Import your first text
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {recentTexts.map((text) => (
              <Link
                key={text.id}
                href={`/reader/${text.id}`}
                className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-100 to-purple-100 text-indigo-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.962 8.962 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.962 8.962 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.962 8.962 0 00-6 2.292m0-14.25v14.25" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{text.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {text.wordCount.toLocaleString()} words
                  </p>
                </div>
                <div className="flex items-center gap-1 text-sm text-slate-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
