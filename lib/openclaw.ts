import WebSocket from "ws";
import crypto from "crypto";
import fs from "fs";

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

type DeviceIdentity = {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
};

// ─── Device identity helpers ─────────────────────────────────────────────────

function loadDeviceIdentity(): DeviceIdentity | null {
  const identityPath = process.env.OPENCLAW_DEVICE_IDENTITY_PATH;
  if (!identityPath) return null;
  try {
    return JSON.parse(fs.readFileSync(identityPath, "utf8")) as DeviceIdentity;
  } catch {
    return null;
  }
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const spkiDer = crypto
    .createPublicKey(publicKeyPem)
    .export({ type: "spki", format: "der" }) as Buffer;
  return Buffer.from(spkiDer).subarray(-32);
}

function publicKeyRawB64Url(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function buildSignedDeviceBlock(
  identity: DeviceIdentity,
  nonce: string
): { id: string; publicKey: string; signature: string; signedAt: number; nonce: string } {
  const signedAtMs = Date.now();
  const payloadStr = [
    "v3",
    identity.deviceId,
    "gateway-client",
    "backend",
    "operator",
    "operator.read,operator.write",
    String(signedAtMs),
    process.env.OPENCLAW_GATEWAY_TOKEN ?? "",
    nonce,
    "node",
    "server",
  ].join("|");

  const signature = base64UrlEncode(
    crypto.sign(null, Buffer.from(payloadStr, "utf8"), crypto.createPrivateKey(identity.privateKeyPem))
  );

  return {
    id: identity.deviceId,
    publicKey: publicKeyRawB64Url(identity.publicKeyPem),
    signature,
    signedAt: signedAtMs,
    nonce,
  };
}

// ─── Singleton state ──────────────────────────────────────────────────────────

const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

const runIdToSession = new Map<string, string>();
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
    const identity = loadDeviceIdentity();
    const deviceToken = process.env.OPENCLAW_DEVICE_TOKEN;

    socket = new WebSocket(wsUrl);

    // Wait for connect.challenge, then send connect
    socket.on("open", () => {
      console.log("[openclaw] WS open, waiting for connect.challenge ...");
    });

    const onChallenge = (raw: WebSocket.RawData) => {
      let msg: WsFrame;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      // Wait for the challenge event
      if (msg.type !== "event" || (msg as { event?: string }).event !== "connect.challenge") {
        return;
      }

      socket!.off("message", onChallenge);

      const nonce = (msg.payload as { nonce?: string })?.nonce;
      if (!nonce) {
        const err = new Error("connect.challenge missing nonce");
        socketPromise = null;
        socket = null;
        reject(err);
        return;
      }

      const connectParams: Record<string, unknown> = {
        minProtocol: 2,
        maxProtocol: 3,
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        auth: {
          token: process.env.OPENCLAW_GATEWAY_TOKEN,
          ...(deviceToken ? { deviceToken } : {}),
        },
        client: {
          id: "gateway-client",
          displayName: "Tagent Backend",
          version: "1.0.0",
          platform: "node",
          deviceFamily: "server",
          mode: "backend",
          instanceId: "tagent-backend",
        },
      };

      if (identity) {
        connectParams.device = buildSignedDeviceBlock(identity, nonce);
      }

      const connectPayload = {
        type: "req",
        id: "connect-init",
        method: "connect",
        params: connectParams,
      };

      console.log("[openclaw] sending connect (device identity:", identity ? "yes" : "no", ")");
      socket!.send(JSON.stringify(connectPayload));

      // Now wait for the connect response
      const onConnectRes = (raw2: WebSocket.RawData) => {
        let msg2: WsFrame;
        try {
          msg2 = JSON.parse(String(raw2));
        } catch {
          return;
        }
        if (msg2.type !== "res" || msg2.id !== "connect-init") return;

        socket!.off("message", onConnectRes);

        if (msg2.ok) {
          const newDeviceToken = (msg2.payload as Record<string, unknown> | null)?.auth as Record<string, unknown> | undefined;
          if (newDeviceToken?.deviceToken) {
            console.log("[openclaw] server issued new device token — update OPENCLAW_DEVICE_TOKEN in .env:", newDeviceToken.deviceToken);
          }
          socketReady = true;
          socket!.on("message", handleMessage);
          resolve();
        } else {
          const errDetail = (msg2 as Record<string, unknown>).error ?? msg2.payload;
          console.error("[openclaw] connect handshake rejected:", JSON.stringify(msg2));
          const err = new Error("OpenClaw connect handshake failed");
          socketPromise = null;
          socket = null;
          reject(err);
        }
      };
      socket!.on("message", onConnectRes);
    };

    socket.on("message", onChallenge);

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
        const errDetail = (msg as Record<string, unknown>).error ?? msg.payload;
        handler.reject(new Error(`OpenClaw error: ${JSON.stringify(errDetail)}`));
      }
    }
    return;
  }

  if (msg.type === "event" && (msg as { event?: string }).event === "agent") {
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

  // Prefix sessionKey so OpenClaw creates a new named session (not the default "main")
  const wsSessionKey = `run:${sessionKey}`;

  const result = await send<{ runId: string; acceptedAt: number }>("agent", {
    message,
    agentId,
    sessionKey: wsSessionKey,
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

  const wsSessionKey = `run:${sessionKey}`;

  const result = await send<{ runId: string; acceptedAt: number }>("agent", {
    message,
    agentId: "sourcing",
    sessionKey: wsSessionKey,
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
