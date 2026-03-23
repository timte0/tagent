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
│   │   ├── integrations/        # Phase 7 — credential management
│   │   ├── settings/
│   │   └── billing/
│   ├── admin/                   # ADMIN-only section
│   └── api/
│       ├── auth/
│       ├── jobs/
│       ├── agent/
│       │   ├── trigger/         # Starts a sourcing run (Playwright pipeline)
│       │   ├── auth/resolve/    # Credential resolution for OpenClaw (future use)
│       │   ├── callback/        # Dead code — OpenClaw WS replaced this
│       │   ├── run/active/      # Returns active run for the current org
│       │   └── stream/[runId]/  # SSE endpoint
│       ├── integrations/
│       │   └── [toolSlug]/
│       │       ├── credentials/ # POST (save) + DELETE
│       │       └── status/      # GET isActive (polling)
│       ├── billing/
│       └── admin/
├── prisma/
│   └── schema.prisma
├── lib/
│   ├── auth.ts                  # JWT helpers
│   ├── auth-context.ts          # Ephemeral auth_context_id store (future OpenClaw use)
│   ├── prisma.ts                # Prisma client singleton
│   ├── openclaw.ts              # OpenClaw WS client (not used in hot path currently)
│   ├── job-parser.ts            # OpenRouter call to extract search params from JD
│   ├── scrapers/
│   │   └── linkedin.ts          # Playwright LinkedIn people search scraper
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

# OpenClaw (WS connection — kept for future orchestration use)
OPENCLAW_URL=""                      # e.g. http://your-vps:18789
OPENCLAW_GATEWAY_TOKEN=""            # token for WS connect auth
OPENCLAW_DEVICE_TOKEN=""             # device-bound operator token
OPENCLAW_DEVICE_IDENTITY_PATH=""     # path to .openclaw-device-identity.json
OPENCLAW_CALLBACK_SECRET=""          # shared secret for /api/agent/auth/resolve

# OpenRouter (LLM for job description parsing)
OPENROUTER_API_KEY=""
OPENROUTER_MODEL=""                  # optional, defaults to anthropic/claude-haiku-4-5

# Stripe
STRIPE_SECRET_KEY=""
STRIPE_WEBHOOK_SECRET=""
STRIPE_STARTER_PRICE_ID=""          # $100/month
STRIPE_GROWTH_PRICE_ID=""           # $200/month
STRIPE_SCALE_PRICE_ID=""            # $600/month

# App
NEXT_PUBLIC_APP_URL=""               # e.g. https://yourapp.com
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

## 8. Sourcing pipeline

### 8.1 Overview

Sourcing runs entirely app-side. OpenClaw is **not** used in the hot path. The trigger route
fires a background pipeline that scrapes LinkedIn with Playwright, then stores results.

```
POST /api/agent/trigger
  → create AgentRun (RUNNING)
  → return { runId } immediately
  → void runSourcingPipeline(...)     ← background, no await

runSourcingPipeline:
  1. parseJobDescription() via OpenRouter → { title, location, company, keywords }
  2. load + decrypt LinkedIn ToolCredential for this user
  3. publishRunEvent(TOOL_COMPLETE "Searching for X in Y…")
  4. scrapeLinkedIn() via Playwright → LinkedInCandidate[]
  5. handleCompletion() → store results, mark COMPLETED, publishRunEvent
```

### 8.2 LinkedIn scraper (`lib/scrapers/linkedin.ts`)

Uses `playwright` (Chromium, headless). Must be installed on the VPS:
```bash
npx playwright install chromium --with-deps
```

Flow:
1. Launch Chromium with `--no-sandbox` (required on VPS)
2. Log in at `https://www.linkedin.com/login` with stored credentials
3. Navigate to people search URL with combined `title + location + keywords` query
4. Wait for `.reusable-search__result-container`, extract up to 25 profile cards
5. Return `LinkedInCandidate[]` — always close browser in `finally`

Throws `LinkedInAuthError` on bad credentials or security checkpoint.
Returns `[]` (empty list) if search yields no results — does not throw.

### 8.3 SSE streaming

- Endpoint: `GET /api/agent/stream/[runId]`
- Uses Node.js `EventEmitter` (`lib/sse.ts`) — `publishRunEvent(runId, data)` → SSE push
- On connect: sends all existing `RunStep` records as catch-up, then subscribes to live events
- Sends `{ __type: "close" }` when run reaches `COMPLETED` or `FAILED`
- Frontend `AgentRunContext.tsx` uses `EventSource` with auto-reconnect
- Header `X-Accel-Buffering: no` disables Nginx buffering (important on VPS)

### 8.4 OpenClaw (kept, not in hot path)

`lib/openclaw.ts` maintains a singleton WebSocket to OpenClaw. The WS connection and
`triggerAgentRun()` / `unregisterRun()` are intact and available for future use
(e.g. ranking/summarisation post-scrape, or if a LinkedIn tool is registered in OpenClaw).

`/api/agent/auth/resolve` (POST) — credential resolution endpoint. OpenClaw's tool wrapper
would call this to exchange an `auth_context_id` for plaintext credentials. Secured by
`OPENCLAW_CALLBACK_SECRET` header. Not called in the current pipeline but ready for use.

**Do NOT pass `sessionKey` in `triggerAgentRun()` params.** Doing so caused
`"agent 'sourcing' does not match session key agent 'main'"` errors.

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

### Credential save

Credentials are marked `isActive: true` immediately on save. No connection test is performed at
save time — real validation happens during the first agent run (a `LinkedInAuthError` will surface
in the sidebar if credentials are wrong).

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
|  - Tool steps    |  - Job detail + results          |
|                  |  - Integrations                  |
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
5. Agent trigger + SSE stream + app-side Playwright sourcing pipeline
6. Integrations page (credential save/update/disconnect)
7. Billing (Stripe subscription, top-up, webhook handler, monthly reset cron)
8. Admin panel (invite manager, manual top-up, audit log, global tool toggle)
9. CSV export
10. Usage warnings (80% alert email + in-app)
11. Log cleanup cron (90-day retention)
12. Nginx + HTTPS on the VPS (reverse proxy in front of Next.js on port 3000, Let's Encrypt TLS, then set `COOKIE_SECURE=true` in `.env`)

---

## 16. Current state (as of 2026-03-23)

### What is done
- **Phases 1–6** fully implemented and deployed on the VPS.
- The app is running via PM2 (`pm2 list` → `tagent`, online) on `http://51.254.139.70:3000`.
- OpenClaw is running on the same VPS, listening on `127.0.0.1:18789` — WS pairing complete but OpenClaw is NOT in the sourcing hot path.
- Sourcing pipeline runs entirely app-side: Playwright scrapes LinkedIn, results stored in `AgentRun.results`.
- Integrations page live: users can connect/update/disconnect LinkedIn and HelloWork credentials.
- Job description parsing via OpenRouter (claude-haiku-4-5) extracts title, location, keywords for the search query.
- Login: `admin@tagent.local` / `changeme_admin_123!` | `manager@tagent.local` / `changeme_manager_123!`
- PDF upload (pdf-parse v1 + `serverExternalPackages`) and URL scraping both work.

### VPS setup required after deploy
```bash
npm install
npx playwright install chromium --with-deps
pm2 restart tagent --update-env
```

### VPS environment notes
- `OPENCLAW_URL=http://127.0.0.1:18789` — OpenClaw only listens on localhost.
- `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000` — callbacks back to the app.
- `COOKIE_SECURE` is not set (HTTP only). Set to `true` once HTTPS is in place.
- `OPENCLAW_DEVICE_IDENTITY_PATH` — path to `.openclaw-device-identity.json` on the VPS.
- `OPENCLAW_DEVICE_TOKEN` — obtained via `openclaw devices rotate …` after pairing.
- PM2 env reload: always use `pm2 restart tagent --update-env` after `.env` changes.
- `OPENROUTER_API_KEY` — required for job description parsing. Set in `.env`.

### Architectural decisions made
- **Plan approval removed from MVP** — OpenClaw's sourcing agent never emitted a `paused` lifecycle event; scrapped rather than debugged.
- **OpenClaw removed from sourcing hot path** — the sourcing agent had no `linkedin_search` tool registered, so it returned LLM-only responses with no real data. Replaced with direct Playwright scraping.
- **No connection test on credential save** — the OpenClaw-based connection test always failed (agent had no tool to call). Credentials are now marked `isActive: true` on save; bad credentials surface as `LinkedInAuthError` during the first run.
- **`lib/openclaw.ts` kept intact** — available for future use (e.g. post-scrape ranking/summarisation).

### Next steps
1. **Test Playwright scraping** on the VPS — deploy current code, add LinkedIn credentials via `/integrations`, trigger a run, verify `AgentRun.results` contains real profiles.
2. **Phase 7** — Billing (Stripe subscription, top-up, webhook handler, monthly reset cron).
3. **Long term** — Nginx + HTTPS (phase 12) before any real users.
