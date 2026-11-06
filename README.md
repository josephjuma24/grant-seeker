# GrantSeeker Intelligence

**AI-assisted funding discovery for researchers, universities and NGOs in Africa.**

GrantSeeker runs autonomous agents that harvest funding calls from funder sources and screen them so only calls that applicants based in Africa can apply to, with a stated award amount, are listed. It then scores each call against the user's full profile and helps them prepare an application. Expired calls are tracked and archived on a fixed schedule, and repeated calls get a history of what changed between editions. The dashboard updates live as the agents work.

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Business rules](#business-rules)
- [The harvester](#the-harvester)
- [API overview](#api-overview)
- [Security model](#security-model)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Legacy code](#legacy-code)

---

## Features

**Discovery**
- **Autonomous harvesting** from Grants.gov keyword searches, RSS feeds and funder web pages (pages are read with Gemini), on a schedule or on demand.
- **Africa-first catalogue:** a call is listed only if it states an award amount above $0 **and** applicants based in Africa can apply (Africa or an African country, worldwide/international, or low- and middle-income countries). Other calls are screened out but kept in the database.
- **Grant Explorer:** list (default), tiles and split-pane details views; filters for category, funder, region (Africa decided by meaning, not by name) and organisation type; a high-match filter.

**Matching**
- **Smart Profile:** upload a CV, proposals or organisation documents (PDF, Word); a structured profile is extracted and its completeness is shown.
- **Fit scoring** against the whole profile: eligibility gates (geography, applicant type, career stage, registration) and six weighted components, with evidence and gaps to close. Uses Gemini embeddings when configured, and a local matcher otherwise.
- **Alerts** when a newly harvested call scores above the notification threshold.

**Applications**
- **AI Proposal Assistant:** eligibility review, proposal outline, partner suggestions and compliance check for a chosen call, saved to the application.
- **Export** a call and the AI work on it (match assessment, drafts, checklist) to **Word or PDF**.
- **Application pipeline** with status transitions, budgets and approvals, plus a **Collaboration Hub** for teams (shared calls, members, messages).

**Lifecycle and insight**
- **Active → Expired → Archived:** calls that ended up to 30 days ago are *expired*; after that they are *archived* automatically. Admins can archive early and restore.
- **Call History:** every edition of a recurring call (new cycle, new reference number, or a funder page updated in place), with plain-language highlights of what changed in amount, deadline, eligibility, focus and wording.
- **Live dashboard:** available pool, average award, critical deadlines (due within 30 days), expired calls, the Africa-eligibility metric and harvester status, pushed to the browser as soon as data changes.

**Administration**
- Role-based access (researcher → grant officer → institution admin → super admin), organisations with invite codes, user suspension, access reviews.
- Append-only, hash-chained **audit log** with a verification endpoint.

---

## How it works

```mermaid
flowchart LR
    subgraph Sources
        GG[Grants.gov API]
        RSS[RSS feeds]
        PG[Funder pages]
    end

    subgraph Worker["Harvester worker (node-cron)"]
        H[Harvest + normalise] --> R[Africa / amount screening]
        R --> E[Embeddings]
        E --> M[Match scoring + alerts]
        L[Close, expire, archive]
    end

    subgraph DB["PostgreSQL 16 + pgvector (RLS)"]
        T[(grants, matches,<br/>profiles, proposals,<br/>audit log)]
    end

    subgraph API["API (Express)"]
        REST[REST /api/*]
        SSE[Live events<br/>/api/grants/live]
    end

    Web[React web app]

    GG & RSS & PG --> H
    Worker --> T
    T -- NOTIFY grants_changed --> SSE
    REST <--> T
    Web <--> REST
    SSE --> Web
```

- The **API** and the **harvester worker** are separate Node processes that share one PostgreSQL database. In development, `npm run dev` starts both.
- **Row-level security** applies to every query. The API connects as `gs_app` and the worker as `gs_worker`; neither role owns tables or bypasses RLS.
- **Live updates:** database triggers send `NOTIFY grants_changed` whenever calls, matches or harvest runs change. The API turns these into Server-Sent Events, and open dashboards re-fetch.

---

## Tech stack

| Layer | Technology |
|---|---|
| Web app | React 19, Vite 6, Tailwind CSS 4, Recharts, Motion, Lucide icons |
| API | Node.js, Express 4, Zod validation, Helmet, express-rate-limit |
| Database | PostgreSQL 16, pgvector, pgcrypto, citext; Drizzle ORM and drizzle-kit migrations |
| Auth | Ed25519 JWT access tokens (`jose`), rotating refresh tokens in HttpOnly cookies, Argon2id passwords, optional Google sign-in |
| AI | Google Gemini (`@google/genai`) for page extraction, embeddings, match rationale and the proposal assistant; a local matcher when no key is set |
| Harvester | node-cron, fast-xml-parser, unpdf and mammoth for documents |
| Email | Nodemailer (SMTP); printed to the log in development |

---

## Repository layout

```
.
├── src/                    React web app
│   ├── App.tsx             Main shell: dashboard, explorer, tracker, admin panels
│   ├── api.ts              Typed API client
│   ├── exportGrant.ts      Word / PDF export
│   └── components/         Smart Profile, Call History, Export menu, settings, …
├── server/
│   ├── server.ts           API entry point (Express + Vite middleware in dev)
│   ├── config/             Environment validation
│   ├── routes/             auth, users, profile, grants, proposals, collaboration, assistant, admin
│   ├── middleware/         auth, RBAC, rate limits, validation, audit logging
│   ├── lib/                Matching, fit scoring, call history, live updates, mailer, tokens, …
│   ├── workers/            Harvester: scheduler, pipeline, source adapters
│   ├── db/
│   │   ├── schema.ts       Drizzle schema, including RLS policies
│   │   ├── migrations/     Generated SQL migrations
│   │   ├── sql/            Bootstrap (roles, extensions) and hardening (grants, triggers)
│   │   └── migrate.ts      Migration runner and one-off JSON import
│   └── scripts/            dev runner, key generation, role bootstrap
├── shared/                 Code used by both browser and server
│   ├── grantLifecycle.ts   30-day archive and critical-deadline rules
│   ├── regions.ts          Geographic eligibility and the Africa catalogue rule
│   └── profile.ts          Structured profile and fit types
├── server-db.json          Seed data from the prototype (optional import)
├── server.ts               Legacy prototype, not used (see below)
└── .env.example            Configuration template
```

---

## Getting started

### Prerequisites

- **Node.js 22** (20 or later should work) and npm
- **PostgreSQL 16 with the pgvector extension.** The simplest option is Docker with the `pgvector/pgvector:pg16` image.
- Optional: a **Google Gemini API key** for AI features, SMTP credentials, and Google OAuth credentials.

### 1. Install dependencies

```bash
npm install
```

### 2. Start PostgreSQL

```bash
docker run -d --name gs-pgdev -p 55432:5432 -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg16
```

Create the database and a role that owns its tables. The migration creates the `gs_app` and `gs_worker` login roles, so the owner needs `CREATEROLE`; you set their passwords in step 5. For a quick local setup you can use the `postgres` superuser as the owner instead.

```bash
docker exec -i gs-pgdev psql -U postgres <<'SQL'
CREATE ROLE grantseeker_owner LOGIN CREATEROLE PASSWORD 'change-me-owner';
CREATE DATABASE grantseeker OWNER grantseeker_owner;
\c grantseeker
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
SQL
```

### 3. Configure the environment

```bash
cp .env.example .env
```

Edit `.env` and set the three connection strings to your database (port `55432` in the Docker example above):

```dotenv
MIGRATION_DATABASE_URL="postgres://grantseeker_owner:change-me-owner@localhost:55432/grantseeker"
DATABASE_URL="postgres://gs_app:change-me-app@localhost:55432/grantseeker"
WORKER_DATABASE_URL="postgres://gs_worker:change-me-worker@localhost:55432/grantseeker"
```

Generate the JWT signing keys:

```bash
npm run keys >> .env
```

### 4. Run the migrations

```bash
npm run db:migrate
```

To also load the prototype's seed data from `server-db.json`:

```bash
npm run db:migrate -- --import-json
```

### 5. Set the login role passwords

```bash
docker exec -i gs-pgdev psql -U postgres -d grantseeker <<'SQL'
ALTER ROLE gs_app PASSWORD 'change-me-app';
ALTER ROLE gs_worker PASSWORD 'change-me-worker';
SQL
```

### 6. Run the app

```bash
npm run dev
```

This starts the API (with the web app served through Vite) and the harvester worker together. Open <http://localhost:3000> and register an account.

### 7. Make yourself an administrator

No route can grant a role above the caller's own, so the first super admin is created from the command line:

```bash
npm run admin:grant-role -- you@example.org super_admin
```

Sign out and back in. The **AI Web Scraper Panel** then lets you start a harvest straight away.

---

## Configuration

All settings live in `.env` (see [.env.example](.env.example)). They are validated at start-up: a missing or malformed value stops the process with a clear message.

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | API connection (`gs_app`) | required |
| `MIGRATION_DATABASE_URL` | Migrations and admin scripts (table owner) | required for migrations |
| `WORKER_DATABASE_URL` | Harvester connection (`gs_worker`) | falls back to `DATABASE_URL` |
| `DATABASE_SSL` | `disable`, `require` or `verify-full` | `disable` |
| `DATABASE_POOL_MAX` | API connection pool size | `20` |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | Ed25519 PEM keys (`npm run keys`) | required |
| `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_DAYS` | Token lifetimes | `900` / `30` |
| `CORS_ORIGIN` | Allowed browser origins (comma-separated) | `http://localhost:3000` |
| `TRUST_PROXY` | Express `trust proxy` (hop count or preset) | `loopback` |
| `APP_URL` | Public URL used in emailed links | `http://localhost:3000` |
| `GEMINI_API_KEY` | Enables AI extraction, embeddings and the assistant | unset: local matcher |
| `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL` | Model names | `gemini-3.5-flash`, `gemini-embedding-001` |
| `SCRAPE_CRON` | Harvest schedule | `0 6,12 * * *` |
| `HOUSEKEEPING_CRON` | Close, expire and archive calls; purge expired sessions | `0 2 * * *` |
| `CRON_TIMEZONE` | Time zone for both schedules | `Africa/Nairobi` |
| `SCRAPE_ON_START` | Harvest once when the worker starts | `false` |
| `HARVEST_DEFAULT_SOURCES` | Include the built-in Grants.gov searches | `true` |
| `MATCH_NOTIFY_THRESHOLD` | Alert when a new call scores at least this | `80` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google (set both or neither) | unset |
| `SMTP_URL`, `MAIL_FROM` | Outgoing email (password resets) | unset: printed to the log |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Keep new accounts at guest level until verified | `false` |
| `PASSWORD_BREACH_CHECK` | Have I Been Pwned k-anonymity check on sign-up | `true` |

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API + harvester with reload on change |
| `node server/scripts/dev.mjs --no-watch` | Same, without file watching (useful in preview panes and git worktrees) |
| `npm run dev:api` / `npm run worker` | Run the API or the harvester on its own |
| `npm run db:migrate` | Apply bootstrap SQL, Drizzle migrations and hardening SQL |
| `npm run db:generate` | Generate a migration after editing `server/db/schema.ts` |
| `npm run keys` | Print a new Ed25519 key pair for `.env` |
| `npm run admin:grant-role -- <email> <role>` | Set a user's role (`researcher`, `grant_officer`, `institution_admin`, `super_admin`) |
| `npm run lint` | Type-check the web app and the server |
| `npm run build` | Build the web app and bundle the API and worker into `dist/` |
| `npm start` / `npm run start:worker` | Run the production API / worker from `dist/` |

---

## Business rules

The rules live in shared modules, so the API, the harvester and the browser always agree.

| Rule | Where | Summary |
|---|---|---|
| **Catalogue** | [`shared/regions.ts`](shared/regions.ts), [`server/lib/grantQueries.ts`](server/lib/grantQueries.ts) | Listed calls state an amount above $0 and are open to African applicants. Screened-out calls are hidden everywhere but kept, and can be reviewed with `GET /api/grants?screened=only`. |
| **Lifecycle** | [`shared/grantLifecycle.ts`](shared/grantLifecycle.ts) | *Active:* open. *Expired:* ended up to 30 days ago. *Archived:* ended more than 30 days ago, or archived early by an admin. A call's end date is the earlier of its deadline and the day it closed. Calls archived by age cannot be restored. |
| **Critical deadlines** | [`shared/grantLifecycle.ts`](shared/grantLifecycle.ts) | Open calls due within 30 days; "this week" means within 7 days. |
| **Dashboard figures** | [`server/routes/grants.routes.ts`](server/routes/grants.routes.ts) | Pool and average count listed open calls only; the average skips calls with no amount. |
| **Fit score** | [`server/lib/fitScoring.ts`](server/lib/fitScoring.ts) | Gates decide eligibility. The score weights thematic alignment 35%, track record 25%, capacity 15%, partnership 10%, deadline 10%, funder history 5%. |
| **Call history** | [`server/lib/callHistory.ts`](server/lib/callHistory.ts) | Editions are linked by funder plus a normalised title (years, fiscal years and round numbers removed), or by a shared reference-number pattern; earlier page versions are kept in `grant_revisions`. |

---

## The harvester

The worker ([`server/workers/scraperScheduler.ts`](server/workers/scraperScheduler.ts)) runs:

- **Harvest** on `SCRAPE_CRON`. It harvests every source, screens and stores calls, computes embeddings, rescores matches, and sends alerts.
- **Housekeeping** on `HOUSEKEEPING_CRON`. It closes calls past their deadline, archives calls that ended more than 30 days ago, and purges expired sessions.
- **Run now:** an admin's request through `POST /api/admin/scraper/run`, delivered with Postgres `NOTIFY`.

**Sources** are the built-in Grants.gov searches plus any funder with a `scrape_config`:

```jsonc
{ "adapter": "grantsgov", "keyword": "maternal health", "rows": 25 }
{ "adapter": "rss",  "url": "https://funder.example.org/calls.rss" }
{ "adapter": "page", "url": "https://funder.example.org/open-calls" }   // needs GEMINI_API_KEY
```

Set it on the funder row (`funders.scrape_config`). It is picked up on the next run.

> **Tip:** the built-in sources are US federal (Grants.gov). Of those calls, only the ones whose text says foreign organisations can apply pass the Africa rule. Funder sources that publish Africa-focused or international calls (for example Wellcome, Gates Grand Challenges, the African Academy of Sciences, IDRC or national research funds) add the most to the catalogue.

---

## API overview

All endpoints are under `/api`. Errors take the form `{ "error": { "code", "message" } }`.

| Area | Endpoints |
|---|---|
| Health | `GET /health` |
| Auth | `POST /auth/register`, `/login`, `/refresh`, `/logout`, `/logout-all`, `/google`, `/password/forgot`, `/password/reset`; `GET /auth/me`, `/sessions` |
| Grants | `GET /grants` (filters: `q`, `category`, `funder`, `region`, `lifecycle`, `screened`, amounts, deadlines, `sort`), `/grants/:id`, `/grants/:id/history`, `/grants/:id/similar`, `/grants/stats`, `/grants/live` (SSE), `/grants/funders`, `/grants/search/semantic` |
| Matching | `GET /grants/matches`, `/grants/:id/match`; `POST /grants/:id/match/feedback`; `GET /profile/matches`, `POST /profile/rescore` |
| Lifecycle (super admin) | `POST /grants/:id/archive`, `/grants/:id/restore`, `/grants/archive-expired` |
| Profile | `GET`/`PUT /profile`, `POST /profile/documents`, `DELETE /profile/documents/:id` |
| Applications | `/proposals`, `/proposals/:id`, `/:id/transition`, `/:id/events`, `/:id/budget`, `/:id/budget/approve` |
| Assistant | `GET /assistant/context/:grantId`, `POST /assistant/generate` |
| Collaboration | `/collaboration/teams`, members, shared grants, messages |
| Users and orgs | `/users/me`, notifications, activity; `/users/org`, members, invite codes |
| Admin | users, organisations, access policy and review, scraper runs/sources/schedule, audit log and verification |

---

## Security model

- **Row-level security on every table.** Each request runs in a transaction that sets the caller's user, organisation and role level. Policies decide what they can read and write, and the worker only gets the tables and columns it needs.
- **Tokens:** short-lived Ed25519 access tokens; refresh tokens rotate within a token family, and reuse revokes the family. Refresh and logout require a CSRF header and an allowed origin.
- **Passwords:** Argon2id, with an optional Have I Been Pwned check; failed logins lead to a temporary lockout.
- **Rate limits** on the whole API, and stricter ones for login, sign-up, refresh, password resets and the AI assistant.
- **Audit:** an append-only, hash-chained log of sensitive actions (`GET /api/admin/audit/verify` checks the chain).
- **Headers:** Helmet, with a strict Content-Security-Policy in production.

---

## Deployment

```bash
npm run build
NODE_ENV=production npm start          # API + built web app on PORT (default 3000)
NODE_ENV=production npm run start:worker
```

- Run `npm run db:migrate` (with `MIGRATION_DATABASE_URL`) before starting a new version.
- Run **one** worker. The API can scale horizontally, but rate-limit counters are in memory, so several API replicas need a shared store (see [`server/middleware/rateLimit.ts`](server/middleware/rateLimit.ts)).
- Behind a proxy, set `TRUST_PROXY` correctly. Make sure the proxy doesn't buffer `GET /api/grants/live`, which is a Server-Sent Events stream.
- Use `DATABASE_SSL=verify-full` against a managed database.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:55432` | PostgreSQL isn't running. Start Docker and the database container. |
| API restarts in a loop in a git worktree | Vite writes temporary files into a shared `node_modules`. Run `node server/scripts/dev.mjs --no-watch`, or `npm install` inside the worktree. |
| "Too many requests; slow down" | The API rate limit (600 requests per 15 minutes per IP) was hit, usually by local testing. Restarting the API resets it. |
| Dashboard badge shows "Reconnecting" | The live stream dropped. It reconnects automatically, and the figures still refresh every 5 minutes. |
| Very few calls listed | The catalogue only lists priced calls open to African applicants. Add Africa-focused or international funder sources (see [The harvester](#the-harvester)). |

---

## Legacy code

`server.ts` (repository root, `npm run dev:legacy`) comes from an earlier version and is **not** used by the current app. It is kept for reference and can be removed. An earlier FastAPI prototype in `backend/` was removed; it remains in git history.

---

## Licence

This repository doesn't include a licence yet. Add one before distributing the code.
