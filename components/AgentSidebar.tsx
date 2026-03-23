"use client";

import { useAgentRun } from "./AgentRunContext";

const STEP_LABELS: Record<string, string> = {
  TOOL_COMPLETE: "Tool finished",
  COMPLETED: "Run completed",
  ERROR: "Error",
};

const STATUS_DOT: Record<string, string> = {
  PENDING: "bg-gray-400",
  RUNNING: "bg-blue-500 animate-pulse",
  COMPLETED: "bg-green-500",
  FAILED: "bg-red-500",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

export default function AgentSidebar() {
  const { activeRun, steps, initialCheckDone } = useAgentRun();

  return (
    <aside className="w-72 min-h-[calc(100vh-56px)] border-r border-gray-200 bg-white flex flex-col shrink-0">
      <div className="px-4 py-4 border-b border-gray-100">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">
          Agent
        </h2>
      </div>

      {!initialCheckDone ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !activeRun ? (
        <div className="flex-1 flex flex-col items-center justify-center px-4 text-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-lg">
            ·
          </div>
          <p className="text-xs text-gray-400">No active run.</p>
          <p className="text-xs text-gray-300">
            Open a job and click Run Agent to start.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Status header */}
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  STATUS_DOT[activeRun.status] ?? "bg-gray-400"
                }`}
              />
              <span className="text-sm font-medium text-gray-800">
                {STATUS_LABEL[activeRun.status] ?? activeRun.status}
              </span>
            </div>
            {activeRun.job?.title && (
              <p className="mt-0.5 text-xs text-gray-400 truncate">
                {activeRun.job.title}
              </p>
            )}
          </div>

          {/* Step log */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {steps.length === 0 ? (
              <p className="text-xs text-gray-400">Waiting for first step…</p>
            ) : (
              [...steps].reverse().map((step) => (
                <div
                  key={step.id}
                  className={`rounded-lg px-3 py-2 text-xs ${
                    step.type === "ERROR"
                      ? "bg-red-50 border border-red-100 text-red-700"
                      : step.type === "COMPLETED"
                      ? "bg-green-50 border border-green-100 text-green-700"
                      : "bg-gray-50 border border-gray-100 text-gray-700"
                  }`}
                >
                  <p className="font-semibold">
                    {STEP_LABELS[step.type] ?? step.type}
                  </p>
                  {step.type === "TOOL_COMPLETE" && (
                    <p className="mt-0.5 text-gray-500">
                      {(step.content as { tool?: string; summary?: string }).tool}
                      {" — "}
                      {(step.content as { summary?: string }).summary}
                    </p>
                  )}
                  {step.type === "COMPLETED" && (
                    <p className="mt-0.5 text-gray-500">
                      {(step.content as { candidateCount?: number }).candidateCount ?? 0} candidates
                      {" · "}$
                      {((step.content as { usageBilledUsd?: number }).usageBilledUsd ?? 0).toFixed(4)} billed
                    </p>
                  )}
                  {step.type === "ERROR" && (
                    <p className="mt-0.5">
                      {(step.content as { message?: string }).message}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
