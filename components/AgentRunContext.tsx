"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

type RunStep = {
  id: string;
  type: string;
  content: Record<string, unknown>;
  createdAt: string;
};

type ActiveRun = {
  id: string;
  status: string;
  startedAt: string;
  job: { title: string | null } | null;
  steps: RunStep[];
};

type AgentRunContextType = {
  activeRun: ActiveRun | null;
  steps: RunStep[];
  setActiveRunId: (id: string) => void;
  clearActiveRun: () => void;
  initialCheckDone: boolean;
};

const AgentRunContext = createContext<AgentRunContextType>({
  activeRun: null,
  steps: [],
  setActiveRunId: () => {},
  clearActiveRun: () => {},
  initialCheckDone: false,
});

export function AgentRunProvider({ children }: { children: ReactNode }) {
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [initialCheckDone, setInitialCheckDone] = useState(false);

  // On mount, check for an already-active run
  useEffect(() => {
    fetch("/api/agent/run/active")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { run: ActiveRun | null } | null) => {
        if (data?.run) {
          setActiveRun(data.run);
          setSteps(data.run.steps);
        }
      })
      .catch(() => {})
      .finally(() => setInitialCheckDone(true));
  }, []);

  const setActiveRunId = useCallback((id: string) => {
    // Minimal stub until SSE catch-up fills in the details
    setActiveRun((prev) =>
      prev?.id === id
        ? prev
        : { id, status: "RUNNING", startedAt: new Date().toISOString(), job: null, steps: [] }
    );
    setSteps([]);
  }, []);

  const clearActiveRun = useCallback(() => {
    setActiveRun(null);
    setSteps([]);
  }, []);

  // Update run status from incoming SSE steps
  const handleStep = useCallback((step: RunStep) => {
    setSteps((prev) => {
      // Avoid duplicates (catch-up may overlap)
      if (prev.some((s) => s.id === step.id)) return prev;
      return [...prev, step];
    });

    if (step.type === "COMPLETED") {
      setActiveRun((prev) => (prev ? { ...prev, status: "COMPLETED" } : prev));
    }

    if (step.type === "ERROR") {
      setActiveRun((prev) => (prev ? { ...prev, status: "FAILED" } : prev));
    }
  }, []);

  // SSE subscription
  useEffect(() => {
    if (!activeRun?.id) return;
    if (
      activeRun.status === "COMPLETED" ||
      activeRun.status === "FAILED"
    )
      return;

    const es = new EventSource(`/api/agent/stream/${activeRun.id}`);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.__type === "close") {
          es.close();
          return;
        }
        handleStep(data as RunStep);
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; close on persistent failure
      es.close();
    };

    return () => es.close();
  }, [activeRun?.id, activeRun?.status, handleStep]);

  return (
    <AgentRunContext.Provider
      value={{ activeRun, steps, setActiveRunId, clearActiveRun, initialCheckDone }}
    >
      {children}
    </AgentRunContext.Provider>
  );
}

export const useAgentRun = () => useContext(AgentRunContext);
