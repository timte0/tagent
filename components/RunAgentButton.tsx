"use client";

import { useState } from "react";
import { useAgentRun } from "./AgentRunContext";

export default function RunAgentButton({ jobId }: { jobId: string }) {
  const { activeRun, initialCheckDone, setActiveRunId } = useAgentRun();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDisabled =
    !initialCheckDone ||
    loading ||
    (activeRun !== null &&
      activeRun.status !== "COMPLETED" &&
      activeRun.status !== "FAILED");

  async function handleRun() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Failed to start run");
        return;
      }
      setActiveRunId((data as { runId: string }).runId);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleRun}
        disabled={isDisabled}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Starting…" : "Run Agent"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {activeRun &&
        activeRun.status !== "COMPLETED" &&
        activeRun.status !== "FAILED" && (
          <p className="text-xs text-gray-400">A run is already active</p>
        )}
    </div>
  );
}
