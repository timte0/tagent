# CLAUDE.md — Sourcing Agent App

This file is the authoritative reference for this codebase. Read it fully before writing any code.
When in doubt about a decision, check here first. If it is not covered here, ask before assuming.

---

## 1. What this app does

A B2B recruitment sourcing tool. A recruiter uploads a job description (PDF or URL), an AI agent
searches LinkedIn and HelloWork for matching candidates, and returns a structured downloadable CSV.
The full agent process is visible in real time in the UI. Users pay for LLM usage.

---

## 2. Tech stack

| Concern       | Choice                                   |
| ------------- | ---------------------------------------- |
| Framework     | Next.js 14, App Router                   |
| Language      | TypeScript (strict mode, no `any`)       |
| Database      | PostgreSQL                               |
| ORM           | Prisma                                   |
| Styling       | Tailwind CSS only — no component library |
| Auth          | Custom JWT (no NextAuth)                 |
| Payments      | Stripe                                   |
| Real-time     | Server-Sent Events (SSE)                 |
| Agent service | OpenClaw (external, self-hosted)         |
| LLM routing   | OpenRouter API                           |

---

## 3. Project structure

```
/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── layout.tsx
│   ├── (app)/
│   │   ├── layout.tsx           # includes AgentSidebar
│   │   ├── dashboard/
│   │   ├── jobs/
│   │   ├── integrations/
│   │   ├── settings/
│   │   └── billing/
│   ├── admin/                   # ADMIN-only section
│   └── api/
│       ├── auth/
│       ├── jobs/
│       ├── agent/
│       │   ├── trigger/
│       │   ├── callback/        # OpenClaw posts here
│       │   ├── resume/          # App posts here to resume after plan approval
│       │   └── stream/[runId]/  # SSE endpoint
│       ├── integrations/
│       ├── billing/
│       └── admin/
├── prisma/
│   └── schema.prisma
├── lib/
│   ├── auth.ts                  # JWT helpers
│   ├── prisma.ts                # Prisma client singleton
│   ├── openclaw.ts              # OpenClaw HTTP client
│   ├── stripe.ts                # Stripe client
│   ├── crypto.ts                # AES-256 encrypt/decrypt
│   └── sse.ts                   # SSE helpers
├── middleware.ts                 # Route protection by role
└── .env.example
```

---

## 4. Environment variables

These must all exist. Never hardcode any of them.

```bash
# Database
DATABASE_URL=""

# Auth
JWT_SECRET=""                        # long random string, used to sign JWTs

# AES encryption (tool credentials)
AES_KEY=""                           # 32-byte hex string

# OpenClaw
OPENCLAW_URL=""                      # e.g. http://your-vps:18789
OPENCLAW_HOOKS_TOKEN=""              # shared secret for /hooks/agent calls
OPENCLAW_CALLBACK_SECRET=""          # shared secret OpenClaw includes in callbacks to /api/agent/callback

# Stripe
STRIPE_SECRET_KEY=""
STRIPE_WEBHOOK_SECRET=""
STRIPE_STARTER_PRICE_ID=""          # $100/month
STRIPE_GROWTH_PRICE_ID=""           # $200/month
STRIPE_SCALE_PRICE_ID=""            # $600/month

# App
NEXT_PUBLIC_APP_URL=""               # e.g. https://yourapp.com — used in OpenClaw callback URL
```

---

## 5. Database schema (Prisma)

Define all models exactly as specified below. Do not add fields not listed here without flagging it.

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String
  role          Role      @default(USER)
  orgId         String?
  org           Org?      @relation(fields: [orgId], references: [id])
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  runs          AgentRun[]
  credentials   ToolCredential[]
}

enum Role {
  ADMIN
  MANAGER
  USER
}

model Org {
  id                    String    @id @default(cuid())
  name                  String
  tier                  Tier      @default(STARTER)
  monthlyAllowanceUsd   Float     @default(80)
  additionalCreditsUsd  Float     @default(0)
  billingCycleStart     DateTime  @default(now())
  stripeCustomerId      String?
  stripeSubscriptionId  String?
  users                 User[]
  jobs                  Job[]
  runs                  AgentRun[]
  orgTools              OrgTool[]
  transactions          CreditTransaction[]
}

enum Tier {
  STARTER
  GROWTH
  SCALE
}

model Job {
  id          String    @id @default(cuid())
  orgId       String
  org         Org       @relation(fields: [orgId], references: [id])
  userId      String
  title       String?
  sourceType  SourceType
  rawContent  String    @db.Text
  sourceUrl   String?
  createdAt   DateTime  @default(now())
  runs        AgentRun[]
}

enum SourceType {
  PDF
  URL
}

model AgentRun {
  id              String      @id @default(cuid())
  jobId           String
  job             Job         @relation(fields: [jobId], references: [id])
  userId          String
  user            User        @relation(fields: [userId], references: [id])
  orgId           String
  org             Org         @relation(fields: [orgId], references: [id])
  status          RunStatus   @default(PENDING)
  sessionKey      String      @unique  // equals run id, used as OpenClaw sessionKey
  planText        String?     @db.Text
  startedAt       DateTime    @default(now())
  endedAt         DateTime?
  usageCostUsd    Float       @default(0)
  usageBilledUsd  Float       @default(0)
  results         Json?       // structured candidate list
  steps           RunStep[]
}

enum RunStatus {
  PENDING
  RUNNING
  PAUSED_FOR_APPROVAL
  COMPLETED
  FAILED
}

model RunStep {
  id        String      @id @default(cuid())
  runId     String
  run       AgentRun    @relation(fields: [runId], references: [id])
  type      StepType
  content   Json
  createdAt DateTime    @default(now())
}

enum StepType {
  PLAN_APPROVAL
  TOOL_COMPLETE
  COMPLETED
  ERROR
}

model Tool {
  id                String      @id @default(cuid())
  name              String      @unique
  slug              String      @unique  // e.g. "linkedin", "hellowork"
  authType          AuthType
  isGloballyEnabled Boolean     @default(false)
  orgTools          OrgTool[]
  credentials       ToolCredential[]
}

enum AuthType {
  API_TOKEN
  USER_CREDENTIALS
  DEVELOPER_ONLY
}

model OrgTool {
  orgId     String
  org       Org     @relation(fields: [orgId], references: [id])
  toolId    String
  tool      Tool    @relation(fields: [toolId], references: [id])
  isEnabled Boolean @default(false)

  @@id([orgId, toolId])
}

model ToolCredential {
  id                   String   @id @default(cuid())
  userId               String
  user                 User     @relation(fields: [userId], references: [id])
  toolId               String
  tool                 Tool     @relation(fields: [toolId], references: [id])
  encryptedCredentials String   @db.Text  // AES-256 encrypted JSON
  isActive             Boolean  @default(true)
  createdAt            DateTime @default(now())

  @@unique([userId, toolId])
}

model CreditTransaction {
  id          String          @id @default(cuid())
  orgId       String
  org         Org             @relation(fields: [orgId], references: [id])
  type        TransactionType
  amountUsd   Float
  note        String?
  createdBy   String?         // userId of admin if manual top-up
  createdAt   DateTime        @default(now())
}

enum TransactionType {
  MEMBERSHIP
  TOPUP
  USAGE
  MANUAL_ADMIN
}
```

---

## 6. Authentication

- JWT-based. No NextAuth. No third-party auth provider.
- Tokens are signed with `JWT_SECRET`, expire after 7 days.
- Token is stored in an `httpOnly` cookie named `token`.
- All protected routes are guarded in `middleware.ts` by reading and verifying the cookie.
- On failed login: always return a generic 401 (`"Invalid credentials"`). Never specify which field is wrong.
- Enforce a 3-second artificial delay server-side on every failed login attempt before responding.
- Password hashing: `bcrypt` with 12 salt rounds.

### Route protection rules (middleware.ts)

```
/admin/*          → ADMIN only
/(app)/*          → authenticated users (any role)
/api/admin/*      → ADMIN only
/api/agent/callback → no user auth, validated by OPENCLAW_CALLBACK_SECRET header instead
/api/billing/webhook → no user auth, validated by Stripe signature
```

---

## 7. Roles

Three roles. Enforced at the middleware level and re-checked in API routes.

| Role    | orgId    | Key permissions                                                                       |
| ------- | -------- | ------------------------------------------------------------------------------------- |
| ADMIN   | null     | Everything. Invites Managers. Manual credit top-up. Global tool whitelist.            |
| MANAGER | required | Full org control. Invite/deactivate users. Promote USER to MANAGER. Toggle org tools. |
| USER    | required | Run agent. View own runs. Add own tool credentials.                                   |

Helper to use everywhere:

```ts
// lib/auth.ts
export function requireRole(user: SessionUser, ...roles: Role[]) {
  if (!roles.includes(user.role)) throw new UnauthorizedError();
}
```

---

## 8. Agent communication flow

This is the most important section. Read it carefully.

> **IMPLEMENTATION NOTE:** The original design used HTTP callbacks (`POST /hooks/agent` + callback URL).
> This was scrapped. OpenClaw does not support a `callbackUrl` on the hooks endpoint.
> The actual implementation uses a persistent **WebSocket RPC** connection to OpenClaw.
> All code in `lib/openclaw.ts` reflects the WS approach. The HTTP callback endpoint
> (`app/api/agent/callback/route.ts`) exists but is dead code — do not rely on it.

### 8.1 OpenClaw WS connection

`lib/openclaw.ts` maintains a singleton WebSocket to `OPENCLAW_URL` (replacing `http` with `ws`).

**Handshake sequence:**
1. Connect → OpenClaw sends `{ type: "event", event: "connect.challenge", payload: { nonce } }`
2. Sign the nonce using the Ed25519 device identity (`OPENCLAW_DEVICE_IDENTITY_PATH`) with a v3 payload
3. Send `{ type: "req", id: "connect-init", method: "connect", params: { auth: { token: OPENCLAW_GATEWAY_TOKEN, deviceToken: OPENCLAW_DEVICE_TOKEN }, device: { ...signedBlock }, role: "operator", scopes: ["operator.read", "operator.write"], ... } }`
4. OpenClaw responds `{ type: "res", id: "connect-init", ok: true }` → connection ready

**Device identity:** generated once via `scripts/pair-openclaw-device.mjs`, stored at `OPENCLAW_DEVICE_IDENTITY_PATH`. The device token (`OPENCLAW_DEVICE_TOKEN`) is obtained by running:
```
openclaw devices approve --latest
openclaw devices rotate --device <deviceId> --role operator --scope operator.read --scope operator.write
```

**Three separate OpenClaw tokens (do not confuse them):**
- `OPENCLAW_GATEWAY_TOKEN` — WS connect auth
- `OPENCLAW_DEVICE_TOKEN` — device-bound operator scopes (grants `operator.write`)
- `OPENCLAW_HOOKS_TOKEN` — HTTP `/hooks/agent` endpoint (legacy, currently unused)

### 8.2 Triggering a run

```ts
// lib/openclaw.ts — triggerAgentRun()
WS send: { type: "req", method: "agent", params: {
  message,
  agentId: "sourcing",
  // NO sessionKey — let OpenClaw create a new session
  deliver: false,
  thinking: "low",
  timeout: 600_000,
  idempotencyKey,
}}
// Response: { runId: string; acceptedAt: number }
```

**Critical:** do NOT send `sessionKey` in the trigger call. Sending one caused
`"agent 'sourcing' does not match session key agent 'main'"` errors because it
accidentally matched an existing session with a different agent.

After the trigger resolves, the OpenClaw `runId` is stored in memory:
- `runIdToSession: Map<openclawRunId, ourSessionKey>` — routes incoming events
- `sessionHandlers: Map<ourSessionKey, handler>` — delivers events to the right handler
- `sessionToOpenclawRunId: Map<ourSessionKey, openclawRunId>` — needed for resume

### 8.3 Receiving events

OpenClaw pushes `{ type: "event", event: "agent", payload: AgentEvent }` frames over WS.

```ts
type AgentEvent = {
  runId: string;              // OpenClaw's runId
  seq: number;
  stream: "assistant" | "tool" | "lifecycle";
  ts: number;
  data: Record<string, unknown>;
};
```

**Event routing in `app/api/agent/trigger/route.ts`:**
- `stream === "assistant"` → accumulate `data.text` into `assistantBuffer`
- `stream === "tool"` → create `TOOL_COMPLETE` RunStep, SSE push
- `stream === "lifecycle"`:
  - `data.phase === "paused"` or `"waiting"` → flush `assistantBuffer` as `planText`, set status `PAUSED_FOR_APPROVAL`, create `PLAN_APPROVAL` RunStep, SSE push
  - `data.phase === "end"` → set status `COMPLETED`, deduct billing, create `COMPLETED` RunStep, SSE push
  - `data.phase === "error"` → set status `FAILED`, create `ERROR` RunStep, SSE push

### 8.4 Plan approval resume

When user clicks "Approve & Continue" in the sidebar:

1. Frontend POSTs `{ runId, feedback? }` to `POST /api/agent/resume`
2. Route sets DB status to `RUNNING`, then calls `resumeAgentRun()`
3. `resumeAgentRun()` looks up the stored OpenClaw `runId` (`sessionToOpenclawRunId.get(sessionKey)`)
4. Sends WS `agent` call with `sessionKey: openclawRunId` to resume the paused session
5. New events route through the resume handler (same SSE channel, keyed by our `AgentRun.id`)

**Known limitation:** `sessionToOpenclawRunId` is in-memory. If the process restarts between
trigger and resume, the mapping is lost and resume throws
`"No OpenClaw runId found for sessionKey X"`. Fix for production: add `openclawRunId String?`
to `AgentRun` schema, store it in the trigger route, load it in the resume route.

### 8.5 SSE streaming

- Endpoint: `GET /api/agent/stream/[runId]`
- Uses Node.js `EventEmitter` (`lib/sse.ts`) to bridge the WS event handler → SSE client
- On connect: sends all existing `RunStep` records as catch-up, then subscribes to live events
- Sends `{ __type: "close" }` when run reaches `COMPLETED` or `FAILED`
- Frontend `AgentRunContext.tsx` uses `EventSource` with auto-reconnect
- Header `X-Accel-Buffering: no` disables Nginx buffering (important on VPS)

---

## 9. Billing

### 9.1 Credit model

- Credits are owned at the org level, not per user.
- Two pools per org: `monthlyAllowanceUsd` (resets on billing date) and `additionalCreditsUsd` (never resets).
- Monthly allowance is consumed first. Additional credits only consumed after monthly allowance hits zero.
- Margin is 20%. Cost to user = OpenRouter cost × 1.2. This is applied in the `completed` callback handler.

### 9.2 Tier allowances

| Tier    | Monthly price | Monthly LLM allowance |
| ------- | ------------- | --------------------- |
| STARTER | $100          | $80                   |
| GROWTH  | $200          | $160                  |
| SCALE   | $600          | $480                  |

### 9.3 Pre-launch balance check

Before triggering an agent run, check:

```ts
const available = org.monthlyAllowanceUsd + org.additionalCreditsUsd;
if (available <= 0) throw new InsufficientCreditsError();
```

If insufficient, return a 402 with a clear message. Do not trigger OpenClaw.

### 9.4 Usage warnings

- At 80% of monthly allowance consumed: send an in-app notification (SSE or DB flag) + email to the org's Manager(s).
- The 80% check runs after every `completed` callback deduction.

### 9.5 Monthly reset

A cron job (or Vercel cron) runs daily. For each org where `billingCycleStart` is 30 days ago:

- Reset `monthlyAllowanceUsd` to the tier default
- Update `billingCycleStart` to now
- Write a `MEMBERSHIP` CreditTransaction record
- Do NOT touch `additionalCreditsUsd`

### 9.6 Stripe

- Subscriptions for monthly tiers via Stripe Subscriptions.
- One-time top-ups via Stripe Checkout (Payment Intent).
- Handle these webhook events: `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `checkout.session.completed` (for top-ups).
- Manual top-ups (bank transfer): ADMIN panel only. Write a `MANUAL_ADMIN` CreditTransaction. All manual top-ups are auditable — never delete them.

---

## 10. Credential encryption

Tool credentials (LinkedIn/HelloWork login) must be encrypted before writing to DB and decrypted
only server-side when the agent needs them.

```ts
// lib/crypto.ts
import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const KEY = Buffer.from(process.env.AES_KEY!, "hex"); // 32 bytes

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(ciphertext: string): string {
  const [ivHex, encryptedHex] = ciphertext.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}
```

Credentials are stored as encrypted JSON: `encrypt(JSON.stringify({ email, password }))`.
Never log decrypted credentials. Never return them to the frontend.

---

## 11. Tool permission chain

```
ADMIN enables tool globally (Tool.isGloballyEnabled = true)
  → MANAGER toggles tool for their org (OrgTool.isEnabled = true)
    → USER adds their own credentials for that tool
```

A user cannot activate a tool unless:

1. `Tool.isGloballyEnabled === true` AND
2. `OrgTool.isEnabled === true` for their org

Enforce this check in `POST /api/integrations/[toolSlug]/credentials`.

### Connection test

When a user saves credentials, immediately trigger OpenClaw to test the connection:

```ts
POST /hooks/agent
{
  "message": "Test the connection for tool: <toolSlug>. Attempt to log in using the stored credentials. Report success or failure.",
  "sessionKey": "connection-test:<userId>:<toolSlug>:<timestamp>",
  "agentId": "sourcing"
}
```

The result comes back via the callback endpoint. Map `sessionKey` prefix `connection-test:` to a
separate handler that updates `ToolCredential.isActive` and notifies the user via SSE or a DB notification flag.

---

## 12. UI layout

```
+------------------+----------------------------------+
|  Left sidebar    |  Main content area               |
|  (always visible)|                                  |
|                  |                                  |
|  Agent panel:    |  Changes per route:              |
|  - Run status    |  - Dashboard                     |
|  - Live log      |  - Jobs list                     |
|  - Plan approval |  - Job detail + results          |
|  - Tool steps    |  - Integrations                  |
|                  |  - Billing / Settings            |
+------------------+----------------------------------+
```

- The agent sidebar is always mounted in `app/(app)/layout.tsx`.
- It connects to SSE on mount if there is an active run for the current user's org.
- The main content area is not blocked during a run — the user can navigate freely.
- Only launching a new run is blocked while a run is active.

---

## 13. Key constraints — never violate these

- **Never expose decrypted credentials to the frontend or logs.**
- **Never skip the 3-second delay on failed login.**
- **Never allow a USER to activate a tool the MANAGER has not enabled.**
- **Never allow a run to launch if org balance is zero.**
- **Never delete CreditTransaction records** — they are the audit trail.
- **Never return which field caused a login failure** — always generic error.
- **Always validate the `x-callback-secret` header** before processing any OpenClaw callback.
- **Always validate the Stripe webhook signature** before processing any billing event.
- **The ADMIN role is unique** — there is exactly one ADMIN in the system. Do not build multi-admin flows.
- **`AgentRun.sessionKey` equals `run.id`** — set at creation, never changed. The OpenClaw session is identified by the OpenClaw `runId` (tracked in-memory in `lib/openclaw.ts`).
- **Log retention is 90 days** — build a cleanup job, do not rely on manual deletion.

---

## 14. What is NOT in scope for MVP

- Outreach or messaging to candidates
- CV parsing or ATS integration
- Multi-language support beyond French/English UI
- Mobile app
- Tool request status tracking in-app (fire-and-forget email only)
- WebSocket (use SSE only)
- Multi-admin support

---

## 15. Build order

Work in this order. Do not skip phases.

1. Prisma schema + migrations + seed (ADMIN user + LinkedIn/HelloWork tools)
2. Auth: login, JWT cookie, middleware, logout
3. Org + user management (invite flows, role promotion, deactivation)
4. Job creation (PDF upload + URL input, storage)
5. Agent trigger + callback endpoint + SSE stream
6. Plan approval UI + resume call
7. Integrations page (credential save, connection test)
8. Billing (Stripe subscription, top-up, webhook handler, monthly reset cron)
9. Admin panel (invite manager, manual top-up, audit log, global tool toggle)
10. CSV export
11. Usage warnings (80% alert email + in-app)
12. Log cleanup cron (90-day retention)
13. Nginx + HTTPS on the VPS (reverse proxy in front of Next.js on port 3000, Let's Encrypt TLS, then set `COOKIE_SECURE=true` in `.env`)

---

## 16. Current state (as of 2026-03-22)

### What is done
- **Phases 1–5** fully implemented and deployed on the VPS.
- **Phase 6 (plan approval)** — code is implemented; round-trip not yet fully verified (see active issue below).
- The app is running via PM2 (`pm2 list` → `tagent`, online) on `http://51.254.139.70:3000`.
- OpenClaw is running on the same VPS, listening on `127.0.0.1:18789`.
- WS connection app → OpenClaw confirmed working (Ed25519 device pairing complete).
- Agent trigger works end-to-end: job → Run Agent → events stream → COMPLETED.
- Login: `admin@tagent.local` / `changeme_admin_123!` | `manager@tagent.local` / `changeme_manager_123!`
- PDF upload (pdf-parse v1 + `serverExternalPackages`) and URL scraping both work.

### VPS environment notes
- `OPENCLAW_URL=http://127.0.0.1:18789` — OpenClaw only listens on localhost.
- `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000` — callbacks back to the app.
- `COOKIE_SECURE` is not set (HTTP only). Set to `true` once HTTPS is in place.
- `OPENCLAW_DEVICE_IDENTITY_PATH` — path to `.openclaw-device-identity.json` on the VPS.
- `OPENCLAW_DEVICE_TOKEN` — obtained via `openclaw devices rotate …` after pairing.
- PM2 env reload: always use `pm2 restart tagent --update-env` after `.env` changes.

### Active issue — plan approval not triggering
When running an agent, the run goes directly from RUNNING → COMPLETED without ever hitting
PAUSED_FOR_APPROVAL. This means either:
- OpenClaw's sourcing agent is not sending a `phase === "paused"` lifecycle event, OR
- The `assistantBuffer` is empty when the paused event fires (no `stream === "assistant"` events received before the pause)

**Debugging in place:** `app/api/agent/trigger/route.ts` has a temporary `console.log` on every
event — check `pm2 logs tagent` after a run to see the exact event sequence and `data` fields.
Remove the log line once the issue is understood.

**Resume code is ready** but untested. Once plan approval works, the round-trip should be:
trigger → paused → user clicks Approve → `POST /api/agent/resume` → `resumeAgentRun()` sends
`sessionKey: openclawRunId` over WS → agent continues → COMPLETED.

### Next steps
1. **Fix plan approval** — use the temp logging to see what events OpenClaw sends; determine
   whether the sourcing agent actually pauses, and if so, what the correct field/phase name is.
2. **Phase 7** — Integrations page (LinkedIn/HelloWork credential save + connection test).
3. **Long term** — Nginx + HTTPS (phase 13) before any real users.
