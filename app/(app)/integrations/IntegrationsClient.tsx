"use client";

import { useState } from "react";
import type { ToolWithStatus } from "./page";

const TOOL_DESCRIPTIONS: Record<string, string> = {
  linkedin: "Search and source candidates on LinkedIn.",
  hellowork: "Search and source candidates on HelloWork.",
};

type CardState = {
  showForm: boolean;
  // LinkedIn uses liAt; other tools use email + password
  liAt: string;
  email: string;
  password: string;
  saving: boolean;
  deleting: boolean;
  testing: boolean;
  testResult: "connected" | "failed" | "timeout" | null;
  error: string | null;
  credential: ToolWithStatus["credential"];
};

function isValidLiAt(value: string): boolean {
  return value.trim().length >= 100 && !/\s/.test(value.trim());
}

export default function IntegrationsClient({
  tools,
}: {
  tools: ToolWithStatus[];
}) {
  const [state, setState] = useState<Record<string, CardState>>(() => {
    const init: Record<string, CardState> = {};
    for (const t of tools) {
      init[t.slug] = {
        showForm: false,
        liAt: "",
        email: "",
        password: "",
        saving: false,
        deleting: false,
        testing: false,
        testResult: null,
        error: null,
        credential: t.credential,
      };
    }
    return init;
  });

  function patch(slug: string, updates: Partial<CardState>) {
    setState((prev) => ({
      ...prev,
      [slug]: { ...prev[slug], ...updates },
    }));
  }

  async function handleSave(slug: string) {
    const s = state[slug];

    if (slug === "linkedin") {
      if (!s.liAt.trim()) {
        patch(slug, { error: "Please paste your li_at cookie value." });
        return;
      }
      if (!isValidLiAt(s.liAt)) {
        patch(slug, {
          error:
            "This doesn't look like a valid li_at cookie. Make sure you copied the full value.",
        });
        return;
      }
    } else {
      if (!s.email || !s.password) {
        patch(slug, { error: "Email and password are required." });
        return;
      }
    }

    patch(slug, { saving: true, error: null });

    try {
      const body =
        slug === "linkedin"
          ? { liAt: s.liAt.trim() }
          : { email: s.email, password: s.password };

      const res = await fetch(`/api/integrations/${slug}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        patch(slug, {
          saving: false,
          error: (data as { error?: string }).error ?? "Failed to save credentials.",
        });
        return;
      }

      patch(slug, {
        saving: false,
        showForm: false,
        liAt: "",
        email: "",
        password: "",
        testing: false,
        testResult: "connected",
        error: null,
        credential: { id: "saved", isActive: true, createdAt: new Date().toISOString() },
      });
    } catch {
      patch(slug, { saving: false, error: "Network error. Please try again." });
    }
  }

  async function handleDelete(slug: string) {
    patch(slug, { deleting: true, error: null });
    try {
      const res = await fetch(`/api/integrations/${slug}/credentials`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        patch(slug, { deleting: false, error: "Failed to disconnect." });
        return;
      }
      patch(slug, {
        deleting: false,
        credential: null,
        testResult: null,
        testing: false,
      });
    } catch {
      patch(slug, { deleting: false, error: "Network error. Please try again." });
    }
  }

  if (tools.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No integrations are currently available. Contact your administrator.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {tools.map((tool) => {
        const s = state[tool.slug];
        if (!s) return null;

        const isConnected = s.credential?.isActive === true && !s.testing;
        const hasCred = s.credential !== null;

        return (
          <div
            key={tool.slug}
            className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-base font-semibold text-gray-900">
                    {tool.name}
                  </h2>
                  <StatusBadge
                    orgEnabled={tool.orgEnabled}
                    testing={s.testing}
                    isConnected={isConnected}
                    testResult={s.testResult}
                    hasCred={hasCred}
                  />
                </div>
                <p className="text-sm text-gray-500">
                  {TOOL_DESCRIPTIONS[tool.slug] ?? ""}
                </p>
              </div>

              {tool.orgEnabled && (
                <div className="flex items-center gap-2 shrink-0">
                  {hasCred && !s.showForm && (
                    <>
                      <button
                        onClick={() => patch(tool.slug, { showForm: true, error: null })}
                        disabled={s.testing || s.deleting}
                        className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-40 transition-colors"
                      >
                        Update
                      </button>
                      <button
                        onClick={() => handleDelete(tool.slug)}
                        disabled={s.deleting || s.testing}
                        className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-40 transition-colors"
                      >
                        {s.deleting ? "Disconnecting…" : "Disconnect"}
                      </button>
                    </>
                  )}
                  {!hasCred && !s.showForm && (
                    <button
                      onClick={() => patch(tool.slug, { showForm: true, error: null })}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
                    >
                      Connect
                    </button>
                  )}
                </div>
              )}
            </div>

            {!tool.orgEnabled && (
              <p className="mt-3 text-xs text-gray-400">
                Your manager has not enabled this tool for your organisation.
              </p>
            )}

            {s.error && (
              <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">
                {s.error}
              </p>
            )}

            {tool.orgEnabled && s.showForm && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSave(tool.slug);
                }}
                className="mt-4 space-y-3 max-w-lg"
              >
                {tool.slug === "linkedin" ? (
                  <LinkedInCookieField
                    value={s.liAt}
                    onChange={(v) => patch(tool.slug, { liAt: v, error: null })}
                  />
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Email
                      </label>
                      <input
                        type="email"
                        required
                        autoComplete="off"
                        value={s.email}
                        onChange={(e) => patch(tool.slug, { email: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="you@example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Password
                      </label>
                      <input
                        type="password"
                        required
                        autoComplete="new-password"
                        value={s.password}
                        onChange={(e) => patch(tool.slug, { password: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={s.saving}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {s.saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      patch(tool.slug, {
                        showForm: false,
                        liAt: "",
                        email: "",
                        password: "",
                        error: null,
                      })
                    }
                    className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── LinkedIn cookie field ─────────────────────────────────────────────────────

function LinkedInCookieField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const trimmed = value.trim();
  const showFormatError =
    trimmed.length > 0 && trimmed.length < 100;

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-blue-50 border border-blue-100 p-4 text-sm text-blue-800 space-y-1">
        <p className="font-medium mb-2">How to find your li_at cookie:</p>
        <ol className="list-decimal list-inside space-y-1 text-blue-700">
          <li>Open <strong>linkedin.com</strong> in your browser and make sure you're logged in</li>
          <li>Open DevTools — press <strong>F12</strong> (Windows) or <strong>Cmd+Opt+I</strong> (Mac)</li>
          <li>Go to <strong>Application</strong> → <strong>Cookies</strong> → <strong>https://www.linkedin.com</strong></li>
          <li>Find the cookie named <strong>li_at</strong> and copy its full value</li>
        </ol>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          li_at cookie value
        </label>
        <textarea
          required
          rows={3}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="AQEDATxxxxxxxxxxxxxxxx…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 font-mono placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
        />
        {showFormatError && (
          <p className="mt-1 text-xs text-red-600">
            This doesn&apos;t look like a valid li_at cookie. Make sure you copied the full value.
          </p>
        )}
        {trimmed.length >= 100 && (
          <p className="mt-1 text-xs text-green-600">
            Format looks good.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({
  orgEnabled,
  testing,
  isConnected,
  testResult,
  hasCred,
}: {
  orgEnabled: boolean;
  testing: boolean;
  isConnected: boolean;
  testResult: CardState["testResult"];
  hasCred: boolean;
}) {
  if (!orgEnabled) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">
        Unavailable
      </span>
    );
  }
  if (testing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
        Testing…
      </span>
    );
  }
  if (isConnected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Connected
      </span>
    );
  }
  if (hasCred && testResult === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        Test failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">
      Not connected
    </span>
  );
}
