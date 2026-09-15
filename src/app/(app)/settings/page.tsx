"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers";

interface SpeedSettings {
  baseWpm: number;
  wordsPerChunk: number;
  highlightOpacity: number;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<SpeedSettings>({
    baseWpm: 350,
    wordsPerChunk: 4,
    highlightOpacity: 0.35,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(data => {
      if (data.settings) {
        setSettings(data.settings);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // handle error
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-slate-500">Customize your reading experience</p>
      </div>

      {/* Reading Speed */}
      <div className="rounded-2xl bg-white border border-slate-100 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Reading Speed</h2>
        <p className="text-sm text-slate-500 mb-6">Control how fast words appear during speed reading</p>

        <div className="space-y-6">
          {/* Base WPM */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-700">Base WPM</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="100"
                  max="1000"
                  value={settings.baseWpm}
                  onChange={(e) => setSettings({ ...settings, baseWpm: parseInt(e.target.value) })}
                  className="w-32 accent-indigo-600"
                />
                <span className="text-sm font-semibold text-slate-900 w-16 text-right">{settings.baseWpm}</span>
              </div>
            </div>
            <p className="text-xs text-slate-400">Words per minute - higher means faster reading</p>
          </div>

          {/* Words Per Chunk */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-700">Words Per Chunk</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="1"
                  max="8"
                  value={settings.wordsPerChunk}
                  onChange={(e) => setSettings({ ...settings, wordsPerChunk: parseInt(e.target.value) })}
                  className="w-32 accent-purple-600"
                />
                <span className="text-sm font-semibold text-slate-900 w-8 text-right">{settings.wordsPerChunk}</span>
              </div>
            </div>
            <p className="text-xs text-slate-400">How many words to highlight at once</p>
          </div>

          {/* Highlight Opacity */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-700">Highlight Opacity</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0.1"
                  max="0.6"
                  step="0.05"
                  value={settings.highlightOpacity}
                  onChange={(e) => setSettings({ ...settings, highlightOpacity: parseFloat(e.target.value) })}
                  className="w-32 accent-purple-600"
                />
                <span className="text-sm font-semibold text-slate-900 w-12 text-right">{Math.round(settings.highlightOpacity * 100)}%</span>
              </div>
            </div>
            <p className="text-xs text-slate-400">How prominent the highlight appears on active words</p>
          </div>
        </div>
      </div>

      {/* Demo Text Preview */}
      <div className="rounded-2xl bg-white border border-slate-100 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Preview</h2>
        <p className="text-sm text-slate-500 mb-4">See how your settings affect the reading experience</p>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
          <p className="text-slate-900 leading-relaxed text-base">
            {("The quick brown fox jumps over the lazy dog. " + " ".repeat(5)).repeat(4).split(" ").map((word, i) => (
              <span
                key={i}
                className={`inline-block transition-all ${
                  i === 2 || i === 3 || i === 4 || i === 5
                    ? "word-highlight active"
                    : i < 2
                    ? "word-highlight"
                    : ""
                }`}
                style={{
                  background: i === 2 || i === 3 || i === 4 || i === 5
                    ? `linear-gradient(180deg, rgba(99, 102, 241, ${settings.highlightOpacity}) 0%, rgba(99, 102, 241, ${settings.highlightOpacity * 0.5}) 100%)`
                    : i < 2
                    ? `linear-gradient(180deg, rgba(99, 102, 241, ${settings.highlightOpacity * 0.6}) 0%, rgba(99, 102, 241, ${settings.highlightOpacity * 0.3}) 100%)`
                    : "transparent",
                  padding: "2px 0",
                }}
              >
                {word}{" "}
              </span>
            ))}
          </p>
        </div>

        <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
          <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Currently showing {settings.wordsPerChunk} words at {settings.baseWpm} WPM
        </div>
      </div>

      {/* Account Info */}
      <div className="rounded-2xl bg-white border border-slate-100 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Account</h2>
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-lg font-medium">
            {user?.name?.charAt(0) || "U"}
          </div>
          <div>
            <p className="font-medium text-slate-900">{user?.name}</p>
            <p className="text-sm text-slate-500">{user?.email}</p>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium shadow-md hover:shadow-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 transition-all flex items-center gap-2"
        >
          {saving ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Saving...
            </>
          ) : saved ? (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Saved!
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
              Save Settings
            </>
          )}
        </button>
      </div>
    </div>
  );
}
