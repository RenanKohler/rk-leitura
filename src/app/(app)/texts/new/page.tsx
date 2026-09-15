"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewTextPage() {
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importedData, setImportedData] = useState<{
    title: string;
    content: string;
    wordCount: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const router = useRouter();

  const handleImport = async () => {
    if (!url.trim()) {
      setUrlError("Please enter a URL");
      return;
    }

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      setUrlError("URL must start with http:// or https://");
      return;
    }

    setUrlError("");
    setImporting(true);

    try {
      const res = await fetch("/api/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setUrlError(data.error || "Failed to import URL");
        return;
      }

      setImportedData(data);
      setTitle(data.title);
    } catch {
      setUrlError("Failed to import URL");
    } finally {
      setImporting(false);
    }
  };

  const handleSave = async () => {
    if (!importedData || !title.trim()) return;

    setSaving(true);

    try {
      const res = await fetch("/api/texts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          sourceUrl: url.trim(),
          content: importedData.content,
          wordCount: importedData.wordCount,
        }),
      });

      if (res.ok) {
        router.push("/texts");
      }
    } catch {
      // handle error
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Import New Text</h1>
        <p className="mt-1 text-slate-500">Paste a URL to import and read an article</p>
      </div>

      {/* URL Import Form */}
      <div className="rounded-2xl bg-white border border-slate-100 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Step 1: Import from URL</h2>
        <p className="text-sm text-slate-500 mb-6">Enter the URL of an article you want to read</p>

        <div className="flex flex-col gap-4">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/article"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
          />

          {urlError && (
            <p className="text-sm text-red-600">{urlError}</p>
          )}

          <button
            onClick={handleImport}
            disabled={importing}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium shadow-md hover:shadow-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {importing ? (
              <>
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Importing...
              </>
            ) : (
              <>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m0 0l-6.75-6.75M12 19.5l6.75-6.75" />
                </svg>
                Import
              </>
            )}
          </button>
        </div>
      </div>

      {/* Imported Data Preview */}
      {importedData && (
        <div className="rounded-2xl bg-white border border-slate-100 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Step 2: Review & Save</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-slate-700">Content</label>
                <span className="text-xs text-slate-400">{importedData.wordCount.toLocaleString()} words</span>
              </div>
              <textarea
                value={importedData.content}
                readOnly
                rows={20}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-100 text-slate-700 focus:outline-none resize-none"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium shadow-md hover:shadow-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
            >
              {saving ? (
                <>
                  <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </>
              ) : (
                <>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Save Text
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
