"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "pdf" | "url";

export default function NewJobPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("pdf");

  // Shared
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PDF
  const [file, setFile] = useState<File | null>(null);

  // URL
  const [url, setUrl] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let res: Response;

      if (mode === "pdf") {
        if (!file) {
          setError("Please select a PDF file.");
          setLoading(false);
          return;
        }
        const form = new FormData();
        form.append("file", file);
        if (title.trim()) form.append("title", title.trim());
        res = await fetch("/api/jobs", { method: "POST", body: form });
      } else {
        if (!url.trim()) {
          setError("Please enter a URL.");
          setLoading(false);
          return;
        }
        res = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim(), title: title.trim() || undefined }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      router.push(`/jobs/${data.job.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <a
          href="/jobs"
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Back to Jobs
        </a>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        New Job Description
      </h1>

      {/* Mode toggle */}
      <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1 mb-6 w-fit">
        <button
          type="button"
          onClick={() => { setMode("pdf"); setError(null); }}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            mode === "pdf"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          PDF Upload
        </button>
        <button
          type="button"
          onClick={() => { setMode("url"); setError(null); }}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            mode === "url"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          URL
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        {error && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Title (optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Senior Backend Engineer – Paris"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* PDF mode */}
          {mode === "pdf" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                PDF file <span className="text-red-500">*</span>
              </label>
              <div
                className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 transition-colors ${
                  file
                    ? "border-blue-400 bg-blue-50"
                    : "border-gray-300 bg-gray-50 hover:border-gray-400"
                }`}
              >
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                {file ? (
                  <p className="text-sm font-medium text-blue-700">{file.name}</p>
                ) : (
                  <>
                    <p className="text-sm text-gray-500">
                      Drop a PDF here or{" "}
                      <span className="font-medium text-blue-600">browse</span>
                    </p>
                    <p className="mt-1 text-xs text-gray-400">Max 10 MB</p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* URL mode */}
          {mode === "url" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Job posting URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://jobs.example.com/senior-engineer"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">
                We will fetch and extract the text content from this page.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading
              ? mode === "pdf"
                ? "Extracting text…"
                : "Fetching URL…"
              : "Create Job"}
          </button>
        </form>
      </div>
    </main>
  );
}
