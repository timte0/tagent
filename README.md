# tagent

A B2B recruitment sourcing tool. Recruiters upload a job description (PDF or URL), and the app searches LinkedIn for matching candidates using a headless Playwright scraper. Results are displayed in real time and exportable as CSV.

## Stack

- **Next.js 14** (App Router, TypeScript strict)
- **PostgreSQL** + **Prisma**
- **Playwright** (headless Chromium, LinkedIn scraping)
- **OpenRouter** (LLM job description parsing)
- **Stripe** (subscriptions + top-ups)
- **SSE** (real-time run progress)
- **OpenClaw** (self-hosted agent service — kept for future use, not in current hot path)

## Getting started

### 1. Install dependencies

```bash
npm install
npx playwright install chromium --with-deps
```

### 2. Set environment variables

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
```

Required:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — long random string for signing JWTs
- `AES_KEY` — 32-byte hex string for credential encryption
- `OPENROUTER_API_KEY` — for job description parsing
- `NEXT_PUBLIC_APP_URL` — e.g. `http://localhost:3000`

### 3. Set up the database

```bash
npx prisma migrate deploy
npx prisma db seed
```

This creates an ADMIN user and seeds the LinkedIn + HelloWork tools.

Default credentials (change after first login):
- Admin: `admin@tagent.local` / `changeme_admin_123!`
- Manager: `manager@tagent.local` / `changeme_manager_123!`

### 4. Run the dev server

```bash
npm run dev
```

## How it works

1. A recruiter uploads a job description (PDF or URL).
2. OpenRouter extracts a structured search query (title, location, keywords).
3. Playwright logs into LinkedIn with the user's stored credentials and scrapes up to 25 matching profiles.
4. Results are streamed to the sidebar in real time via SSE and stored in the database.
5. The recruiter can export results as CSV.

## Integrations

Users connect their LinkedIn account at `/integrations` by providing their `li_at` session cookie
(extracted from browser DevTools). This bypasses LinkedIn security checkpoints that trigger when
logging in from a VPS IP. The cookie is AES-256 encrypted before storage and lasts ~1 year.

A browser extension (Option A) is planned once LinkedIn OAuth approval is confirmed — it would
capture the cookie automatically without the manual DevTools step.

The tool permission chain:
```
ADMIN enables tool globally
  → MANAGER enables for their org
    → USER adds their own credentials
```

## VPS deployment

```bash
npm install
npx playwright install chromium --with-deps
pm2 restart tagent --update-env
```

Playwright requires `--no-sandbox` on VPS (already set in the scraper). See CLAUDE.md section 8 for full architecture details.

## Project structure

See `CLAUDE.md` for the full authoritative reference — schema, API routes, billing model, and architectural decisions.
