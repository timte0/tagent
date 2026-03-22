import WebSocket from "ws";
import crypto from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

type WsFrame =
  | { type: "res"; id: string; ok: boolean; payload: unknown }
  | { type: "event"; event: string; payload: unknown; seq: number }
  | { type: "err"; id: string; code: string; message: string };

export type AgentEvent = {
  runId: string;
  seq: number;
  stream: "assistant" | "tool" | "lifecycle";
  ts: number;
  data: Record<string, unknown>;
};

// ─── Singleton state ──────────────────────────────────────────────────────────

// pendingRequests: reqId → { resolve, reject }
const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

// openclawRunId → our sessionKey (= AgentRun.id)
const runIdToSession = new Map<string, string>();

// sessionKey → event handler
const sessionHandlers = new Map<string, (event: AgentEvent) => void>();

let socket: WebSocket | null = null;
let socketReady = false;
let socketPromise: Promise<void> | null = null;

// ─── Connection ───────────────────────────────────────────────────────────────

function ensureConnected(): Promise<WebSocket> {
  if (socket && socketReady) return Promise.resolve(socket);
  if (socketPromise) return socketPromise.then(() => socket!);

  socketPromise = new Promise<void>((resolve, reject) => {
    const wsUrl = process.env.OPENCLAW_URL!.replace(/^http/, "ws");

    socket = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${process.env.OPENCLAW_HOOKS_TOKEN}`,
      },
    });

    socket.on("open", () => {
      const connectId = "connect-init";
      socket!.send(
        JSON.stringify({
          type: "req",
          id: connectId,
          method: "connect",
          params: {
            minProtocol: 2,
            maxProtocol: 3,
            client: {
              id: "tagent-backend",
              displayName: "Tagent Backend",
              version: "1.0.0",
              platform: "node",
              mode: "cli",
            },
          },
        })
      );

      // Resolve after connect response is received (see message handler below)
      const onConnect = (raw: WebSocket.RawData) => {
        let msg: WsFrame;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (msg.type === "res" && msg.id === connectId) {
          socket!.off("message", onConnect);
          if (msg.ok) {
            socketReady = true;
            socket!.on("message", handleMessage);
            resolve();
          } else {
            console.error("[openclaw] connect handshake rejected:", JSON.stringify(msg));
            const err = new Error("OpenClaw connect handshake failed");
            socket = null;
            socketPromise = null;
            reject(err);
          }
        }
      };
      socket!.on("message", onConnect);
    });

    socket.on("error", (err) => {
      socketReady = false;
      socket = null;
      socketPromise = null;
      reject(err);
    });

    socket.on("close", () => {
      socketReady = false;
      socket = null;
      socketPromise = null;
    });
  });

  return socketPromise.then(() => socket!);
}

function handleMessage(raw: WebSocket.RawData) {
  let msg: WsFrame;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }

  if (msg.type === "res") {
    const handler = pending.get(msg.id);
    if (handler) {
      pending.delete(msg.id);
      if (msg.ok) {
        handler.resolve(msg.payload);
      } else {
        handler.reject(
          new Error(`OpenClaw error: ${JSON.stringify(msg.payload)}`)
        );
      }
    }
    return;
  }

  if (msg.type === "event" && msg.event === "agent") {
    const event = msg.payload as AgentEvent;
    const sessionKey = runIdToSession.get(event.runId);
    if (sessionKey) {
      sessionHandlers.get(sessionKey)?.(event);
    }
  }
}

// ─── Send helper ──────────────────────────────────────────────────────────────

async function send<T>(method: string, params: unknown): Promise<T> {
  const ws = await ensureConnected();
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    ws.send(JSON.stringify({ type: "req", id, method, params }));
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function triggerAgentRun({
  message,
  sessionKey,
  agentId = "sourcing",
  timeoutSeconds = 600,
  onEvent,
}: {
  message: string;
  sessionKey: string;
  agentId?: string;
  timeoutSeconds?: number;
  onEvent: (event: AgentEvent) => void;
}): Promise<string> {
  const idempotencyKey = `${sessionKey}:${Date.now()}`;

  const result = await send<{ runId: string; acceptedAt: number }>("agent", {
    message,
    agentId,
    sessionKey,
    deliver: false,
    thinking: "low",
    timeout: timeoutSeconds * 1000,
    idempotencyKey,
  });

  runIdToSession.set(result.runId, sessionKey);
  sessionHandlers.set(sessionKey, onEvent);

  return result.runId;
}

export async function resumeAgentRun({
  sessionKey,
  message,
  onEvent,
}: {
  sessionKey: string;
  message: string;
  onEvent: (event: AgentEvent) => void;
}): Promise<string> {
  const idempotencyKey = `${sessionKey}:resume:${Date.now()}`;

  const result = await send<{ runId: string; acceptedAt: number }>("agent", {
    message,
    agentId: "sourcing",
    sessionKey,
    deliver: false,
    thinking: "low",
    idempotencyKey,
  });

  runIdToSession.set(result.runId, sessionKey);
  sessionHandlers.set(sessionKey, onEvent);

  return result.runId;
}

export function unregisterRun(sessionKey: string): void {
  sessionHandlers.delete(sessionKey);
}
