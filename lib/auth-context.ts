import crypto from "crypto";

type StoredContext = {
  userId: string;
  // Map of toolSlug → plaintext credentials
  credentials: Record<string, { email: string; password: string }>;
  expiresAt: number;
};

const store = new Map<string, StoredContext>();

const TTL_MS = 10 * 60 * 1000; // 10 minutes

export function createAuthContext(
  userId: string,
  credentials: Record<string, { email: string; password: string }>
): string {
  const id = `li_ctx_${crypto.randomBytes(8).toString("hex")}`;
  store.set(id, { userId, credentials, expiresAt: Date.now() + TTL_MS });
  return id;
}

export function resolveAuthContext(id: string): StoredContext | null {
  const ctx = store.get(id);
  if (!ctx) return null;
  if (Date.now() > ctx.expiresAt) {
    store.delete(id);
    return null;
  }
  store.delete(id); // one-time use
  return ctx;
}
