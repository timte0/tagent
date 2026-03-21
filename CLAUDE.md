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

### 8.1 Triggering a run

Your Next.js backend calls OpenClaw's webhook:

```ts
// lib/openclaw.ts
POST ${OPENCLAW_URL}/hooks/agent
Authorization: Bearer ${OPENCLAW_HOOKS_TOKEN}
Content-Type: application/json

{
  "message": "<full sourcing prompt including JD content>",
  "name": "SourcingRun",
  "sessionKey": "<run.id>",        // CRITICAL — ties callbacks back to this run
  "agentId": "sourcing",           // dedicated sourcing agent in OpenClaw
  "timeoutSeconds": 600
}
```

### 8.2 OpenClaw posts callbacks to your app

OpenClaw's sourcing skill calls `POST ${NEXT_PUBLIC_APP_URL}/api/agent/callback` at each step.

**Authentication:** every callback must include the header:

```
x-callback-secret: ${OPENCLAW_CALLBACK_SECRET}
```

Your callback endpoint must reject any request missing or with a wrong secret with 401.

**Callback payload shape:**

```ts
type CallbackPayload =
  | { runId: string; type: "plan_approval"; plan: string }
  | { runId: string; type: "tool_complete"; tool: string; summary: string }
  | {
      runId: string;
      type: "completed";
      candidates: Candidate[];
      usageCostUsd: number;
    }
  | { runId: string; type: "error"; message: string };

type Candidate = {
  fullName?: string;
  currentTitle?: string;
  company?: string;
  location?: string;
  linkedinUrl?: string;
  email?: string;
  phone?: string;
  cvLink?: string;
  skills?: string[];
  source: string; // "linkedin" | "hellowork"
};
```

**What your callback endpoint does per type:**

- `plan_approval` → write plan to run record, set status `PAUSED_FOR_APPROVAL`, append RunStep, SSE push to user
- `tool_complete` → append RunStep, SSE push to user
- `completed` → write results to run record, set status `COMPLETED`, set `endedAt`, deduct `usageBilledUsd` (= `usageCostUsd * 1.2`) from org balance, append RunStep, SSE push to user
- `error` → set status `FAILED`, set `endedAt`, append RunStep, SSE push to user

### 8.3 Plan approval resume

When user approves (or modifies) the plan, your backend calls OpenClaw again:

```ts
POST ${OPENCLAW_URL}/hooks/agent
Authorization: Bearer ${OPENCLAW_HOOKS_TOKEN}

{
  "message": "<user feedback text, or 'Approved' if no changes>",
  "sessionKey": "<run.id>",    // same sessionKey — resumes the paused session
  "agentId": "sourcing"
}
```

Set run status back to `RUNNING` immediately when this call is made.

### 8.4 SSE streaming

- Endpoint: `GET /api/agent/stream/[runId]`
- Returns `Content-Type: text/event-stream`
- The server holds the connection open and writes events as callbacks arrive
- Use a simple in-memory event emitter (e.g. Node.js `EventEmitter`) keyed by `runId` to bridge
  the callback endpoint and the SSE endpoint within the same process
- Each SSE event is a JSON-serialised `RunStep`
- The client reconnects automatically if the connection drops (use `EventSource` with retry logic)
- The SSE connection closes when the run reaches `COMPLETED` or `FAILED`

**Important:** SSE works correctly on Vercel only if the route is configured as a streaming route.
If deploying to a VPS (recommended given OpenClaw requirement), this is not an issue.

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
- **Session keys are immutable** — once a run is created, its `sessionKey` never changes.
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

## 16. Current state (as of 2026-03-21)

### What is done
- Phases 1–5 are fully implemented and deployed on the VPS.
- The app is running via PM2 (`pm2 list` → `tagent`, online) on `http://51.254.139.70:3000`.
- OpenClaw is running on the same VPS, listening on `127.0.0.1:18789`.
- The connection from the app to OpenClaw is confirmed working.
- Login works with `admin@tagent.local` / `changeme_admin_123!`.

### VPS environment notes
- `OPENCLAW_URL=http://127.0.0.1:18789` — OpenClaw only listens on localhost, not the public IP.
- `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000` — used by OpenClaw to POST callbacks back to the app.
- `COOKIE_SECURE` is not set (left unset = false) because the app is still on HTTP. Set to `true` once HTTPS is in place.

### Next steps
1. **End-to-end agent test** — log in, create a job (paste a job description as URL or upload PDF), click Run Agent, watch the sidebar for live steps and plan approval.
2. **Phase 6** — Plan approval UI and resume call (partially in place via the sidebar, verify the full round-trip works).
3. **Phase 7** — Integrations page (LinkedIn/HelloWork credential save + connection test).
4. Long term: set up Nginx + HTTPS (phase 13) before any real users.
