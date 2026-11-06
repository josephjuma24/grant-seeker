# GrantSeeker Intelligence: AI Grant Discovery & Application Platform for Africa

[![Node.js](https://img.shields.io/badge/Node.js-v22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20%2B%20pgvector-4169E1?logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Google GenAI](https://img.shields.io/badge/Google%20GenAI-Gemini%203.5%20Flash-8E44AD?logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![Focus](https://img.shields.io/badge/Focus-Africa--first%20catalogue-2E7D32)](#-business-rules)
[![Security](https://img.shields.io/badge/Security-RLS%20%C2%B7%20Argon2id%20%C2%B7%20Ed25519-B71C1C)](#-security-privacy--responsible-ai)

> **GrantSeeker** is an AI-powered grant intelligence platform that helps researchers, universities and NGOs in Africa find funding they can actually win. Autonomous agents harvest funding calls, keep only those open to African applicants with a stated award, rank each call against the user's full profile, and help turn the best matches into strong, compliant applications.

---

## 📋 Table of Contents

1. [Executive Overview & Mission](#-executive-overview--mission)
2. [Who GrantSeeker Serves](#-who-grantseeker-serves)
3. [The Four-Stage Operational Loop](#-the-four-stage-operational-loop)
4. [Key Features & Functional Modules](#-key-features--functional-modules)
5. [Full-Stack Architecture & Dataflow](#-full-stack-architecture--dataflow)
6. [Technology Stack](#-technology-stack)
7. [Repository Layout](#-repository-layout)
8. [Getting Started & Local Setup](#-getting-started--local-setup)
9. [Environment Configuration](#-environment-configuration)
10. [Scripts & Commands](#-scripts--commands)
11. [End-to-End Usage Guide](#-end-to-end-usage-guide)
12. [Business Rules](#-business-rules)
13. [The Harvester & Data Sources](#-the-harvester--data-sources)
14. [API Reference](#-api-reference)
15. [Security, Privacy & Responsible AI](#-security-privacy--responsible-ai)
16. [Production Deployment](#-production-deployment)
17. [Troubleshooting](#-troubleshooting)
18. [Contributing Guidelines](#-contributing-guidelines)
19. [Licence & Legacy Code](#-licence--legacy-code)

---

## 🌍 Executive Overview & Mission

**GrantSeeker** is a grant intelligence platform for **researchers, research offices, universities and NGOs across Africa**. It replaces hours of manual searching across funder websites, newsletters and portals with a live, ranked catalogue of calls that the user is eligible for, and then supports the work that follows discovery: eligibility checks, drafting, team review, institutional approval and outcome tracking.

### The Funding Access Gap

- **Most published calls are not open to African applicants.** Many are limited to US or EU organisations, and the restriction is often buried deep in the call text.
- **Calls are scattered.** Funder portals, RSS feeds and web pages each publish in their own format and on their own schedule.
- **Fit is hard to judge.** Applicants find out late that a call excludes their career stage, organisation type or country.
- **Proposals start from a blank page,** and institutional sign-off is tracked in email threads.

### Our Mission

> Put every relevant, winnable funding call in front of the right African applicant early enough to apply well, and make the path from discovery to submission fast, transparent and accountable.

GrantSeeker does this with an **Africa-first catalogue rule**, **explainable fit scores**, an **AI Proposal Assistant**, and a **live dashboard** that updates the moment the harvesting agents change the data. For a non-technical overview of every module and its value, see [About GrantSeeker](docs/About%20GrantSeeker.README.md).

---

## 👥 Who GrantSeeker Serves

| User | What they need | What GrantSeeker gives them |
|---|---|---|
| **Researcher / applicant** | Calls they can actually win, without searching dozens of sites | A short, ranked list of eligible calls with the reasons for each score, plus help drafting |
| **Grant officer** (research office) | Visibility and control over the institution's applications | One pipeline of proposals with review, approval and budget steps |
| **Institution admin** | Governance of who does what | Members, roles, invite codes, access reviews and an audit trail |
| **Platform admin** | A fresh, trustworthy catalogue | Harvester control, source management, health and audit verification |

---

## 🔄 The Four-Stage Operational Loop

```mermaid
flowchart LR
    A["1 · Harvest<br/>Collect calls from<br/>funder sources"] --> B["2 · Screen<br/>Keep priced calls<br/>open to Africa"]
    B --> C["3 · Match<br/>Score each call against<br/>every user profile"]
    C --> D["4 · Act<br/>Alert, draft, review,<br/>submit, track"]
    D -. "Housekeeping: close, expire, archive" .-> A
```

| Stage | What happens | Where |
|---|---|---|
| **1. Harvest** | Agents collect calls from Grants.gov searches, RSS feeds and funder web pages (read with Gemini), twice a day or on demand, and normalise them. | [`server/workers/`](server/workers/) |
| **2. Screen** | A call is listed only if it states an award above $0 **and** applicants based in Africa can apply. Everything else is kept but hidden. | [`shared/regions.ts`](shared/regions.ts) |
| **3. Match** | Eligibility gates plus six weighted components produce a fit score with evidence and gaps. Strong new matches trigger alerts. | [`server/lib/fitScoring.ts`](server/lib/fitScoring.ts) |
| **4. Act** | The AI Proposal Assistant drafts and checks; applications move through review, approval and submission; outcomes are tracked. | [`server/routes/`](server/routes/) |

Each night, **housekeeping** closes calls past their deadline, moves them from **Active → Expired → Archived**, and purges expired sessions, so the dashboard never shows money that is no longer available.

---

## ✨ Key Features & Functional Modules

### 🔎 Discovery
- **Autonomous harvesting** from Grants.gov keyword searches, RSS feeds and funder web pages, on a schedule or on demand.
- **Africa-first catalogue:** listed calls are open to applicants in Africa (an African country, Africa as a region, worldwide/international, or low- and middle-income countries) and state an award amount above $0.
- **Grant Explorer:** list (default), tile and split-pane detail views; filters for category, funder, region (Africa is decided by meaning, not by name) and organisation type; a high-match filter; Active, Expired and Archived tabs.

### 🎯 Matching
- **Smart Profile:** upload a CV, proposals or organisation documents (PDF, Word). A structured profile is extracted, each value is linked to the line it came from, and profile completeness is shown.
- **Explainable fit scoring:** eligibility gates (geography, applicant type, career stage, registration) and six weighted components, with evidence and gaps to close. Uses Gemini embeddings when configured, and a local matcher otherwise.
- **Match alerts** when a newly harvested call scores above the notification threshold.

### ✍️ Applications
- **AI Proposal Assistant:** eligibility review, proposal outline, partner suggestions and compliance check for a chosen call, saved to the application with a checklist.
- **Export to Word or PDF:** a call plus the AI work on it (match assessment, drafts, checklist), ready to share with co-applicants and committees.
- **Application pipeline:** draft → review → approved → submitted → awarded / rejected, with budgets, approvals and a timeline.
- **Collaboration Hub:** teams, members, shared calls and messages; an opt-in researcher directory that never shows email addresses.

### 📊 Lifecycle & Insight
- **Live Intelligence Dashboard:** available pool, average award, critical deadlines (due within 30 days), expired calls, the Africa-eligibility metric and harvester status, pushed to the browser as soon as data changes.
- **Call History:** every edition of a recurring call, with plain-language highlights of what changed in amount, deadline, eligibility, focus and wording.
- **Lifecycle management:** calls that ended up to 30 days ago are *expired*, then *archived* automatically. Admins can archive early and restore.

### 🛡️ Administration
- **Role-based access:** researcher → grant officer → institution admin → super admin; organisations with invite codes; user suspension; access reviews.
- **Tamper-evident audit log:** append-only and hash-chained, with a verification endpoint.

---

## 🧱 Full-Stack Architecture & Dataflow

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

- **Two processes, one database.** The **API** and the **harvester worker** are separate Node processes that share one PostgreSQL database. In development, `npm run dev` starts both.
- **Row-level security everywhere.** The API connects as `gs_app` and the worker as `gs_worker`; neither role owns tables or bypasses RLS.
- **Live updates.** Database triggers send `NOTIFY grants_changed` whenever calls, matches or harvest runs change. The API turns these into Server-Sent Events, and open dashboards re-fetch.

---

## 🧰 Technology Stack

| Layer | Technology |
|---|---|
| **Web app** | React 19, Vite 6, Tailwind CSS 4, Recharts, Motion, Lucide icons |
| **API** | Node.js 22, Express 4, Zod validation, Helmet, express-rate-limit |
| **Database** | PostgreSQL 16, pgvector, pgcrypto, citext; Drizzle ORM and drizzle-kit migrations |
| **Auth** | Ed25519 JWT access tokens (`jose`), rotating refresh tokens in HttpOnly cookies, Argon2id passwords, optional Google sign-in |
| **AI** | Google Gemini (`@google/genai`) for page extraction, embeddings, match rationale and the proposal assistant; a local matcher when no key is set |
| **Harvester** | node-cron, fast-xml-parser, unpdf and mammoth for documents |
| **Email** | Nodemailer (SMTP); printed to the log in development |
| **Language** | TypeScript 5.8 across browser, server and shared rules |

---

## 📁 Repository Layout

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
├── docs/                   About GrantSeeker (non-technical overview)
├── server-db.json          Seed data from the prototype (optional import)
├── server.ts               Legacy prototype, not used (see below)
└── .env.example            Configuration template
```

---

## 🚀 Getting Started & Local Setup

### Prerequisites

- **Node.js 22** (20 or later should work) and npm
- **PostgreSQL 16 with the pgvector extension.** The simplest option is Docker with the `pgvector/pgvector:pg16` image.
- *Optional:* a **Google Gemini API key** for AI features, SMTP credentials, and Google OAuth credentials.

### Step 1: Install dependencies

```bash
npm install
```

### Step 2: Start PostgreSQL

```bash
docker run -d --name gs-pgdev -p 55432:5432 -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg16
```

Create the database and a role that owns its tables. The migration creates the `gs_app` and `gs_worker` login roles, so the owner needs `CREATEROLE`; you set their passwords in Step 5. For a quick local setup you can use the `postgres` superuser as the owner instead.

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

### Step 3: Configure the environment

```bash
cp .env.example .env
```

Set the three connection strings in `.env` (port `55432` in the Docker example above):

```dotenv
MIGRATION_DATABASE_URL="postgres://grantseeker_owner:change-me-owner@localhost:55432/grantseeker"
DATABASE_URL="postgres://gs_app:change-me-app@localhost:55432/grantseeker"
WORKER_DATABASE_URL="postgres://gs_worker:change-me-worker@localhost:55432/grantseeker"
```

Generate the JWT signing keys:

```bash
npm run keys >> .env
```

### Step 4: Run the migrations

```bash
npm run db:migrate
```

To also load the prototype's seed data from `server-db.json`:

```bash
npm run db:migrate -- --import-json
```

### Step 5: Set the login role passwords

```bash
docker exec -i gs-pgdev psql -U postgres -d grantseeker <<'SQL'
ALTER ROLE gs_app PASSWORD 'change-me-app';
ALTER ROLE gs_worker PASSWORD 'change-me-worker';
SQL
```

### Step 6: Run the app

```bash
npm run dev
```

This starts the API (with the web app served through Vite) and the harvester worker together. Open **<http://localhost:3000>** and register an account.

### Step 7: Make yourself an administrator

No route can grant a role above the caller's own, so the first super admin is created from the command line:

```bash
npm run admin:grant-role -- you@example.org super_admin
```

Sign out and back in. The **AI Web Scraper Panel** then lets you start a harvest straight away.

---

## 🔧 Environment Configuration

All settings live in `.env` (see [`.env.example`](.env.example)). They are validated at start-up: a missing or malformed value stops the process with a clear message.

### Database & runtime

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | API connection (`gs_app`) | required |
| `MIGRATION_DATABASE_URL` | Migrations and admin scripts (table owner) | required for migrations |
| `WORKER_DATABASE_URL` | Harvester connection (`gs_worker`) | falls back to `DATABASE_URL` |
| `DATABASE_SSL` | `disable`, `require` or `verify-full` | `disable` |
| `DATABASE_POOL_MAX` | API connection pool size | `20` |
| `CORS_ORIGIN` | Allowed browser origins (comma-separated) | `http://localhost:3000` |
| `TRUST_PROXY` | Express `trust proxy` (hop count or preset) | `loopback` |
| `APP_URL` | Public URL used in emailed links | `http://localhost:3000` |

### Authentication

| Variable | Purpose | Default |
|---|---|---|
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | Ed25519 PEM keys (`npm run keys`) | required |
| `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_DAYS` | Token lifetimes | `900` / `30` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google (set both or neither) | unset |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Keep new accounts at guest level until verified | `false` |
| `PASSWORD_BREACH_CHECK` | Have I Been Pwned k-anonymity check on sign-up | `true` |
| `SMTP_URL`, `MAIL_FROM` | Outgoing email (password resets) | unset: printed to the log |

### AI & harvester

| Variable | Purpose | Default |
|---|---|---|
| `GEMINI_API_KEY` | Enables AI extraction, embeddings and the assistant | unset: local matcher |
| `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL` | Model names | `gemini-3.5-flash`, `gemini-embedding-001` |
| `SCRAPE_CRON` | Harvest schedule | `0 6,12 * * *` |
| `HOUSEKEEPING_CRON` | Close, expire and archive calls; purge expired sessions | `0 2 * * *` |
| `CRON_TIMEZONE` | Time zone for both schedules | `Africa/Nairobi` |
| `SCRAPE_ON_START` | Harvest once when the worker starts | `false` |
| `HARVEST_DEFAULT_SOURCES` | Include the built-in Grants.gov searches | `true` |
| `MATCH_NOTIFY_THRESHOLD` | Alert when a new call scores at least this | `80` |

---

## 💻 Scripts & Commands

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

## 🧭 End-to-End Usage Guide

### For researchers and applicants

1. **Register and build your Smart Profile.** Fill in the sign-up form, then upload a CV, past proposals or organisation documents. Check the extracted values and follow the completeness hints.
2. **Review your matches.** The dashboard and Grant Explorer rank calls by fit. Open a call to see its eligibility verdict, score breakdown, evidence and the gaps to close.
3. **Explore the catalogue.** Filter by category, funder, region and organisation type; switch between list, tile and details views; use the high-match filter to focus.
4. **Check the history.** For a recurring call, open **Call History** to see what changed since the last edition.
5. **Draft with the AI Proposal Assistant.** Generate an eligibility review, outline, partner suggestions and compliance check, then save them to your application.
6. **Export and share.** Download the call and the AI work as Word or PDF for co-applicants and supervisors.
7. **Track progress** in **My Saved Applications** from draft through to the funder's decision.

### For research offices and admins

1. **Invite members** with organisation invite codes and assign roles.
2. **Review and approve** proposals and budgets in the **Research Office** before submission.
3. **Manage the harvester** in the **AI Web Scraper Panel:** run a harvest now, review sources and schedules, and check run history.
4. **Govern access** with access reviews, user suspension and the verifiable audit log.

---

## 📐 Business Rules

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

## 🌐 The Harvester & Data Sources

The worker ([`server/workers/scraperScheduler.ts`](server/workers/scraperScheduler.ts)) runs three kinds of job:

| Job | Trigger | What it does |
|---|---|---|
| **Harvest** | `SCRAPE_CRON` | Harvests every source, screens and stores calls, computes embeddings, rescores matches and sends alerts. |
| **Housekeeping** | `HOUSEKEEPING_CRON` | Closes calls past their deadline, archives calls that ended more than 30 days ago, and purges expired sessions. |
| **Run now** | `POST /api/admin/scraper/run` | An admin's on-demand request, delivered to the worker with Postgres `NOTIFY`. |

**Sources** are the built-in Grants.gov searches plus any funder with a `scrape_config`:

```jsonc
{ "adapter": "grantsgov", "keyword": "maternal health", "rows": 25 }
{ "adapter": "rss",  "url": "https://funder.example.org/calls.rss" }
{ "adapter": "page", "url": "https://funder.example.org/open-calls" }   // needs GEMINI_API_KEY
```

Set it on the funder row (`funders.scrape_config`); it is picked up on the next run.

> [!TIP]
> The built-in sources are US federal (Grants.gov), and only calls whose text says foreign organisations can apply pass the Africa rule. Funder sources that publish Africa-focused or international calls (for example Wellcome, Gates Grand Challenges, the African Academy of Sciences, IDRC or national research funds) add the most to the catalogue.

---

## 🔌 API Reference

All endpoints are under `/api`. Errors take the form `{ "error": { "code", "message" } }`.

| Area | Endpoints |
|---|---|
| **Health** | `GET /health` |
| **Auth** | `POST /auth/register`, `/login`, `/refresh`, `/logout`, `/logout-all`, `/google`, `/password/forgot`, `/password/reset`; `GET /auth/me`, `/sessions` |
| **Grants** | `GET /grants` (filters: `q`, `category`, `funder`, `region`, `lifecycle`, `screened`, amounts, deadlines, `sort`), `/grants/:id`, `/grants/:id/history`, `/grants/:id/similar`, `/grants/stats`, `/grants/live` (SSE), `/grants/funders`, `/grants/search/semantic` |
| **Matching** | `GET /grants/matches`, `/grants/:id/match`; `POST /grants/:id/match/feedback`; `GET /profile/matches`, `POST /profile/rescore` |
| **Lifecycle** (super admin) | `POST /grants/:id/archive`, `/grants/:id/restore`, `/grants/archive-expired` |
| **Profile** | `GET`/`PUT /profile`, `POST /profile/documents`, `DELETE /profile/documents/:id` |
| **Applications** | `/proposals`, `/proposals/:id`, `/:id/transition`, `/:id/events`, `/:id/budget`, `/:id/budget/approve` |
| **Assistant** | `GET /assistant/context/:grantId`, `POST /assistant/generate` |
| **Collaboration** | `/collaboration/teams`, members, shared grants, messages |
| **Users & orgs** | `/users/me`, notifications, activity; `/users/org`, members, invite codes |
| **Admin** | users, organisations, access policy and review, scraper runs/sources/schedule, audit log and verification |

---

## 🔐 Security, Privacy & Responsible AI

### Security model
- **Row-level security on every table.** Each request runs in a transaction that sets the caller's user, organisation and role level. Policies decide what they can read and write, and the worker gets only the tables and columns it needs.
- **Tokens:** short-lived Ed25519 access tokens; refresh tokens rotate within a token family, and reuse revokes the family. Refresh and logout require a CSRF header and an allowed origin.
- **Passwords:** Argon2id, with an optional Have I Been Pwned check; failed logins lead to a temporary lockout.
- **Rate limits** on the whole API, and stricter ones for login, sign-up, refresh, password resets and the AI assistant.
- **Audit:** an append-only, hash-chained log of sensitive actions (`GET /api/admin/audit/verify` checks the chain).
- **Headers:** Helmet, with a strict Content-Security-Policy in production.

### Privacy
- Each organisation's proposals and members are private to it, enforced in the database rather than only in application code.
- The researcher directory is **opt-in** and never shows email addresses.
- The breached-password check uses k-anonymity: only the first characters of the password's hash leave the server.

### Responsible AI
- **Explainable by design.** Every fit score lists its eligibility gates, component weights, supporting evidence and gaps, and every profile value links to the document line it came from.
- **Human in the loop.** AI drafts, outlines and compliance checks are starting points for the applicant to edit; submission and approval are always human decisions.
- **Works without AI.** With no `GEMINI_API_KEY`, matching runs on a local matcher. When a key is set, call text and profile content are sent to Google's Gemini API for extraction, embeddings and drafting, so deployers should cover this in their privacy notice.
- **Nothing is silently discarded.** Screened-out calls stay in the database and can be reviewed, so the catalogue rule can be audited.

---

## 📦 Production Deployment

```bash
npm run build
NODE_ENV=production npm start          # API + built web app on PORT (default 3000)
NODE_ENV=production npm run start:worker
```

- Run `npm run db:migrate` (with `MIGRATION_DATABASE_URL`) before starting a new version.
- Run **one** worker. The API can scale horizontally, but rate-limit counters are in memory, so several API replicas need a shared store (see [`server/middleware/rateLimit.ts`](server/middleware/rateLimit.ts)).
- Behind a proxy, set `TRUST_PROXY` correctly, and make sure the proxy doesn't buffer `GET /api/grants/live`, which is a Server-Sent Events stream.
- Use `DATABASE_SSL=verify-full` against a managed database.

> [!IMPORTANT]
> GrantSeeker needs a **long-running API process, a background worker and PostgreSQL with pgvector**. Host it on a platform that runs persistent Node services (for example Render, Railway, Fly.io or a VPS) with a managed PostgreSQL database. Static and serverless hosts such as Vercel can serve the web app but not the API, the live event stream or the scheduled harvester.

---

## 🩺 Troubleshooting

| Symptom | Fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:55432` | PostgreSQL isn't running. Start Docker and the database container. |
| API restarts in a loop in a git worktree | Vite writes temporary files into a shared `node_modules`. Run `node server/scripts/dev.mjs --no-watch`, or `npm install` inside the worktree. |
| "Too many requests; slow down" | The API rate limit (600 requests per 15 minutes per IP) was hit, usually by local testing. Restarting the API resets it. |
| Dashboard badge shows "Reconnecting" | The live stream dropped. It reconnects automatically, and the figures still refresh every 5 minutes. |
| Very few calls listed | The catalogue only lists priced calls open to African applicants. Add Africa-focused or international funder sources (see [The Harvester & Data Sources](#-the-harvester--data-sources)). |

---

## 🤝 Contributing Guidelines

1. **Create a branch** from `main` for each change.
2. **Keep shared rules shared.** Catalogue, lifecycle and deadline rules belong in [`shared/`](shared/) so the browser, API and worker never disagree.
3. **Change the schema through migrations.** Edit [`server/db/schema.ts`](server/db/schema.ts), run `npm run db:generate`, and commit the generated SQL. Every new table needs row-level security policies.
4. **Type-check before you push:**
   ```bash
   npm run lint
   ```
5. **Never commit secrets.** `.env` is ignored; document new settings in [`.env.example`](.env.example) and in the configuration tables above.
6. **Open a pull request** that explains what changed and why, with screenshots for UI changes.

---

## 📄 Licence & Legacy Code

### Licence
This repository doesn't include a licence yet. Add one before distributing the code.

### Legacy code
`server.ts` (repository root, `npm run dev:legacy`) comes from an earlier version and is **not** used by the current app. It is kept for reference and can be removed. An earlier FastAPI prototype in `backend/` was removed; it remains in git history.

---

<p align="center"><b>GrantSeeker Intelligence</b> · Built for researchers, universities and NGOs in Africa</p>
