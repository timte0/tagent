// One-time device pairing script for OpenClaw.
// Run this once on the VPS, then approve + rotate to get a device token.
//
// Usage:
//   node scripts/pair-openclaw-device.mjs
//
// Required env vars (source your .env first):
//   OPENCLAW_GATEWAY_TOKEN
//   OPENCLAW_URL            (http://127.0.0.1:18789)
//   OPENCLAW_DEVICE_IDENTITY_PATH  (optional, defaults to .openclaw-device-identity.json)

import fs from "fs";
import path from "path";
import crypto from "crypto";
import WebSocket from "ws";

const GATEWAY_URL = (process.env.OPENCLAW_URL || "http://127.0.0.1:18789").replace(/^http/, "ws");
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const IDENTITY_PATH =
  process.env.OPENCLAW_DEVICE_IDENTITY_PATH ||
  path.join(process.cwd(), ".openclaw-device-identity.json");

if (!GATEWAY_TOKEN) {
  console.error("ERROR: OPENCLAW_GATEWAY_TOKEN is not set");
  process.exit(1);
}

// ─── Crypto helpers ───────────────────────────────────────────────────────────

function base64UrlEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function derivePublicKeyRaw(publicKeyPem) {
  const spkiDer = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return Buffer.from(spkiDer).subarray(-32); // last 32 bytes = raw Ed25519 public key
}

function fingerprintPublicKey(publicKeyPem) {
  return crypto.createHash("sha256").update(derivePublicKeyRaw(publicKeyPem)).digest("hex");
}

function publicKeyRawB64Url(publicKeyPem) {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function signV3Payload(privateKeyPem, { deviceId, nonce, signedAtMs }) {
  const payload = [
    "v3",
    deviceId,
    "gateway-client",
    "backend",
    "operator",
    "operator.read,operator.write",
    String(signedAtMs),
    GATEWAY_TOKEN,
    nonce,
    "node",
    "server",
  ].join("|");

  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(privateKeyPem));
  return base64UrlEncode(sig);
}

// ─── Identity file ────────────────────────────────────────────────────────────

function loadOrCreateIdentity() {
  if (fs.existsSync(IDENTITY_PATH)) {
    const data = JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf8"));
    // Verify deviceId matches public key
    const derivedId = fingerprintPublicKey(data.publicKeyPem);
    if (derivedId !== data.deviceId) {
      data.deviceId = derivedId;
      fs.writeFileSync(IDENTITY_PATH, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    }
    return data;
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const identity = {
    version: 1,
    deviceId: fingerprintPublicKey(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(IDENTITY_PATH, JSON.stringify(identity, null, 2) + "\n", { mode: 0o600 });
  console.log(`Generated new device identity → ${IDENTITY_PATH}`);
  return identity;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const identity = loadOrCreateIdentity();
console.log(`Device ID: ${identity.deviceId}`);
console.log(`Connecting to ${GATEWAY_URL} ...`);

const ws = new WebSocket(GATEWAY_URL);

ws.on("open", () => {
  console.log("Connected — waiting for connect.challenge ...");
});

ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw));

  if (msg.type === "event" && msg.event === "connect.challenge") {
    const nonce = msg.payload?.nonce;
    console.log(`Got challenge nonce: ${nonce}`);

    const signedAtMs = Date.now();
    const signature = signV3Payload(identity.privateKeyPem, {
      deviceId: identity.deviceId,
      nonce,
      signedAtMs,
    });

    const connectReq = {
      type: "req",
      id: "connect-init",
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        auth: { token: GATEWAY_TOKEN },
        client: {
          id: "gateway-client",
          displayName: "Tagent Backend",
          version: "1.0.0",
          platform: "node",
          deviceFamily: "server",
          mode: "backend",
          instanceId: "tagent-backend",
        },
        device: {
          id: identity.deviceId,
          publicKey: publicKeyRawB64Url(identity.publicKeyPem),
          signature,
          signedAt: signedAtMs,
          nonce,
        },
      },
    };

    console.log("Sending connect with device identity ...");
    ws.send(JSON.stringify(connectReq));
    return;
  }

  if (msg.type === "res" && msg.id === "connect-init") {
    if (msg.ok) {
      console.log("\n✓ Connect succeeded — pairing request created.");

      const deviceToken = msg.payload?.auth?.deviceToken;
      if (deviceToken) {
        console.log(`\nDevice token returned immediately: ${deviceToken}`);
        console.log("Add to .env: OPENCLAW_DEVICE_TOKEN=" + deviceToken);
      } else {
        console.log("\nNext steps on the VPS:");
        console.log("  openclaw devices list");
        console.log("  openclaw devices approve --latest");
        console.log(`  openclaw devices rotate --device ${identity.deviceId} --role operator --scope operator.read --scope operator.write`);
        console.log("\nThen copy the printed token into your .env as OPENCLAW_DEVICE_TOKEN=<token>");
      }

      ws.close();
      return;
    }

    console.error("\n✗ Connect failed:");
    console.error(JSON.stringify(msg.error ?? msg, null, 2));
    process.exitCode = 1;
    ws.close();
  }
});

ws.on("error", (err) => {
  console.error("WS error:", err.message);
  process.exitCode = 1;
});
