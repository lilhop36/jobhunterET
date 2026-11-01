<div align="center">

# 🎯 JobHunter

### Intelligent Job Search, Aggregation & Matching System for Ethiopia

**Automatically discovers, normalizes, scores, and delivers personalized job matches — with zero manual searching.**

[![CI](https://github.com/lilhop36/jobhunterET/actions/workflows/ci.yml/badge.svg)](https://github.com/lilhop36/jobhunterET/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10-red?logo=nestjs)](https://nestjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-5-2D3748?logo=prisma)](https://www.prisma.io/)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-26A5E4?logo=telegram)](https://core.telegram.org/bots)

### [🟢 Live Demo →](https://jobhunter-e0oasuykh-abdigaboma-1924s-projects.vercel.app/login)

</div>

---

## 📖 What is JobHunter?

JobHunter is a **full-stack, multi-user job search agent** built for the Ethiopian job market. It continuously scrapes job boards, company career pages, NGOs, and international sources — then uses a **deterministic, explainable scoring engine** to match every new job against each user's profile and deliver personalized alerts via **Telegram** or a **web Inbox**.

> **Core promise:** Register once → JobHunter searches continuously → evaluates per user → explains why each match matters → notifies you instantly → you decide whether to apply.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| 🔍 **Automated Collection** | 11 web sources plus 3 Telegram channels, with polite rate limiting and FAST/DEEP sweeps |
| 🧠 **Deterministic Matching** | 7-factor scoring engine — role, skills, experience, location, employment, salary, freshness decay |
| 📊 **Explainable Scores** | Every match shows *why* — matched skills, missing skills, relevance breakdown |
| 📱 **Telegram Alerts** | Instant bot notifications with inline action buttons (Save / Reject / Apply) |
| 📥 **Web Inbox** | Fallback for users without Telegram — no match is ever silently lost |
| 👻 **Ghost Job Detection** | Automatically removes dead listings after 3 missed collection cycles |
| 🔗 **Link-Rot Detection** | Daily sweep validates apply URLs; dead links get flagged |
| 👤 **Multi-User** | Per-user profiles, isolated matches, role-based access (USER / ADMIN) |
| 🎛️ **Admin Dashboard** | Source health monitoring, manual collection triggers, user management |
| 📈 **Match Score Ring** | Animated hero visualization showing match quality at a glance |
| 🌙 **Dark Mode** | Full light/dark theme with system preference detection |
| 🔒 **Security Hardened** | Rate limiting, token revocation, bcrypt hashing, Helmet headers |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        JobHunter System                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐     ┌──────────────────────────────────────┐  │
│  │  Next.js 15  │────▶│        NestJS REST API                │  │
│  │  React 19    │◀────│  JWT Auth · Role Guard · Validation   │  │
│  │  Tailwind    │     └───────────┬──────────────────────────┘  │
│  └──────────────┘                 │                             │
│                                   ▼                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Prisma ORM                             │   │
│  │           SQLite (authoritative, single node)              │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │                                       │
│                         ▼                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Background Workers                           │   │
│  │  ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │   │
│  │  │Collectors │ │ Matcher  │ │ Sweeper  │ │ Notifier  │  │   │
│  │  │12 classes │ │per-user  │ │ghost/ exp│ │Telegram + │  │   │
│  │  │14 endpoints││scoring   │ │link-rot  │ │Web Inbox  │  │   │
│  │  └───────────┘ └──────────┘ └──────────┘ └───────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────┐     ┌──────────────────────────────────────┐  │
│  │   Telegram   │     │        External Job Sources          │  │
│  │   Bot API    │◀────│  EthioJobs · Remotive · ReliefWeb    │  │
│  │  (free tier) │     │  Arbeitnow · Jobicy · GeezJobs ...  │  │
│  └──────────────┘     └──────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 15, React 19, TypeScript, Tailwind CSS, Zustand, Lucide Icons |
| **Backend** | NestJS 10, TypeScript, Passport.js (JWT + Local), class-validator |
| **Database** | SQLite (authoritative, single node), Prisma ORM |
| **Notifications** | Telegram Bot API (free), Web Inbox fallback |
| **Background Jobs** | @nestjs/schedule (cron-based workers) |
| **CI/CD** | GitHub Actions (5-gate pipeline), Vercel (frontend) |
| **Testing** | Jest (see generated facts for the current spec count), Playwright (e2e) |

<!-- BEGIN GENERATED PROJECT FACTS -->
<!-- Generated from source by scripts/generate-architecture-facts.js. Do not edit by hand. -->

| Fact | Current value |
|---|---|
| Stack | Next.js 15.5, React 19.2, NestJS 10.4, Prisma 5.20, TypeScript 5.5 |
| Database | SQLite (authoritative, single-node) |
| Job sources | 11 web sources + 3 Telegram channels (12 adapter classes) |
| Backend | 18 feature modules, 28 spec files / 330 test declarations |
| Frontend | 19 page routes |
| CI | 6 jobs |

<!-- END GENERATED PROJECT FACTS -->

> Detailed inventories live in [docs/architecture-facts.md](docs/architecture-facts.md). Regenerate with `npm run facts:generate`; verify with `npm run facts:check`.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 22+
- SQLite (bundled with the app; no server to install)
- PostgreSQL is optional and only needed for multi-instance deployments
- A Telegram Bot token (from [@BotFather](https://t.me/BotFather))

### Installation

```bash
# Clone the repo
git clone https://github.com/lilhop36/jobhunterET.git
cd jobhunterET

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install

# Set up environment
cd ..
cp .env.example .env
# Edit .env with your database URL, Telegram token, etc.

# Generate Prisma client & apply migrations safely
cd backend
npx prisma generate
node scripts/db-migrate-safe.js

# Existing database created with `db push`? Baseline it once:
# node scripts/db-migrate-safe.js --baseline

# Start development servers
cd ..
npm run dev
```

The safe migration runner backs up the database, tests pending migrations on a verified copy, and refuses drift or row-count changes. It never uses `db push --accept-data-loss`.

The app runs at:
- **Frontend:** http://localhost:3211
- **Backend API:** http://localhost:3210

---

## 🧪 Testing

```bash
# Run all backend tests (23 spec files; parameterized cases expand at runtime)
npm test

# Run with coverage report
cd backend && npm run test -- --coverage

# Run e2e tests
cd frontend && npm run test:e2e
```

---

## 📊 Scoring Engine

JobHunter uses a **7-factor deterministic scoring model** — every score is explainable and reproducible:

```
┌────────────────────┬────────┬────────────────────────────────────┐
│ Factor             │ Weight │ Logic                              │
├────────────────────┼────────┼────────────────────────────────────┤
│ Role Match         │  25%   │ Token-aware phrase/synonym match   │
│ Skill Match        │  30%   │ Direct + transferable + related    │
│ Experience         │  15%   │ Required ≤ yours → 100; floor 30   │
│ Location           │  15%   │ User priority tiers (H/M/L)        │
│ Employment Type    │   5%   │ Match = 100, mismatch = 35         │
│ Salary             │   5%   │ Meets minimum = 100; neutral = 55  │
│ Freshness          │   5%   │ Exponential decay (τ = 72h)        │
└────────────────────┴────────┴────────────────────────────────────┘

Hard eligibility filters run first: ineligible jobs return score 0 with reasons.
Match Categories: 90-100 Excellent · 80-89 Strong · 70-79 Good
                  60-69 Possible    · 0-59 Low
```

---

## 🌍 Job Sources

### Ethiopia (Priority 1)
EthioJobs · Ethio NGO Jobs · GeezJobs · ET Careers · ReliefWeb · Hagere Jobs

### Remote (Priority 2)
Remotive · Arbeitnow · Jobicy · RemoteOK · Landing.jobs

### Telegram channels
ElelanaJobs · ShegerJobs · EthioJobVacancy

---

## 📁 Project Structure

```
jobhunterET/
├── frontend/              # Next.js 15 application
│   ├── app/               # App Router pages (19 routes)
│   ├── components/        # UI components (shell, match carousel, etc.)
│   ├── lib/               # Auth, API store, i18n, utilities
│   └── styles/            # Tailwind + custom CSS
├── backend/               # NestJS API server
│   ├── src/
│   │   ├── modules/       # 18 feature modules (auth, matching, sources, etc.)
│   │   ├── common/        # Guards, decorators, types
│   │   └── prisma/        # Prisma service & schema
│   ├── prisma/            # SQLite schema (active) + PostgreSQL schema
│   ├── scripts/           # Utility scripts (coverage, backup, safe migrations)
│   └── test/              # Jest test suites (23 spec files)
├── docs/                  # Architecture docs, generated facts, ops runbook
├── scripts/               # Architecture checks, DB switching, dev utilities
└── .github/workflows/     # CI pipeline (lint, test, build, audit, architecture)
```

---

## 🏆 What This Project Demonstrates

- **Full-stack TypeScript** — end-to-end type safety across 19 frontend routes and 18 backend feature modules
- **Multi-tenant architecture** — per-user profile isolation, matching, and notification routing
- **Real-world scraping pipeline** — 12 adapter classes over 14 collection endpoints, with normalization, per-source dedup, and quality scoring
- **Explainable AI/ML concepts** — deterministic 7-factor scoring with freshness decay and hard eligibility filters
- **Production DevOps** — GitHub Actions CI (6 gates, including a browser runtime-verification gate), Vercel deployment, SQLite-first with an optional PostgreSQL schema
- **Telegram Bot integration** — inline keyboards, rate limiting, deep-link account linking
- **Security best practices** — JWT with token revocation, bcrypt, Helmet, RBAC, rate limiting
- **330 test declarations across 28 spec files** — unit tests, integration tests, and e2e coverage

---

## 📄 License

Private — All rights reserved.

---

<div align="center">

**Built with ❤️ in Ethiopia 🇪🇹**

*Making job search effortless for Ethiopian talent*

</div>
