"use client";

import { useState } from "react";
import type { ToolWithStatus } from "./page";

const TOOL_DESCRIPTIONS: Record<string, string> = {
  linkedin: "Search and source candidates on LinkedIn.",
  hellowork: "Search and source candidates on HelloWork.",
};

type CardState = {
  showForm: boolean;
  email: string;
  password: string;
  saving: boolean;
  deleting: boolean;
  testing: boolean;
  testResult: "connected" | "failed" | "timeout" | null;
  error: string | null;
  // live credential state (can change after save/delete)
  credential: ToolWithStatus["credential"];
};

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
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
    if (!s.email || !s.password) {
      patch(slug, { error: "Email and password are required." });
      return;
    }

    patch(slug, { saving: true, error: null });

    try {
      const res = await fetch(`/api/integrations/${slug}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: s.email, password: s.password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        patch(slug, {
          saving: false,
          error: (data as { error?: string }).error ?? "Failed to save credentials.",
        });
        return;
      }

      // Clear form, enter testing state
      patch(slug, {
        saving: false,
        showForm: false,
        email: "",
        password: "",
        testing: true,
        testResult: null,
        error: null,
        // Optimistic placeholder credential (isActive=false until test resolves)
        credential: { id: "pending", isActive: false, createdAt: new Date().toISOString() },
      });

      // Poll for test result
      for (let i = 0; i < 15; i++) {
        await sleep(2000);
        try {
          const statusRes = await fetch(`/api/integrations/${slug}/status`);
          if (!statusRes.ok) continue;
          const { isActive } = (await statusRes.json()) as {
            isActive: boolean | null;
          };

          if (isActive === true) {
            patch(slug, {
              testing: false,
              testResult: "connected",
              credential: { id: "active", isActive: true, createdAt: new Date().toISOString() },
            });
            return;
          }
          if (isActive === false) {
            patch(slug, {
              testing: false,
              testResult: "failed",
              credential: { id: "failed", isActive: false, createdAt: new Date().toISOString() },
            });
            return;
          }
          // null = still testing, continue
        } catch {
          // network hiccup — keep polling
        }
      }

      patch(slug, { testing: false, testResult: "timeout" });
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

            {s.testResult === "failed" && (
              <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">
                Connection test failed. Check your credentials and try again.
              </p>
            )}

            {s.testResult === "timeout" && (
              <p className="mt-3 text-sm text-yellow-700 bg-yellow-50 rounded-md px-3 py-2">
                Connection test timed out. Status unknown — try running the agent to verify.
              </p>
            )}

            {tool.orgEnabled && s.showForm && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSave(tool.slug);
                }}
                className="mt-4 space-y-3 max-w-sm"
              >
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
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={s.saving}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {s.saving ? "Saving…" : "Save & Test"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      patch(tool.slug, {
                        showForm: false,
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
