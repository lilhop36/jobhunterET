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

</div>

---

## 📖 What is JobHunter?

JobHunter is a **full-stack, multi-user job search agent** built for the Ethiopian job market. It continuously scrapes job boards, company career pages, NGOs, and international sources — then uses a **deterministic, explainable scoring engine** to match every new job against each user's profile and deliver personalized alerts via **Telegram** or a **web Inbox**.

> **Core promise:** Register once → JobHunter searches continuously → evaluates per user → explains why each match matters → notifies you instantly → you decide whether to apply.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| 🔍 **Automated Collection** | 11+ source adapters (EthioJobs, Remotive, ReliefWeb, Arbeitnow, etc.) with polite rate limiting |
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
│  │           PostgreSQL / SQLite (dev)                        │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │                                       │
│                         ▼                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Background Workers                           │   │
│  │  ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │   │
│  │  │Collectors │ │ Matcher  │ │ Sweeper  │ │ Notifier  │  │   │
│  │  │11 adapters│ │per-user  │ │ghost/ exp│ │Telegram + │  │   │
│  │  │           │ │scoring   │ │link-rot  │ │Web Inbox  │  │   │
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
| **Database** | PostgreSQL (production) / SQLite (development), Prisma ORM |
| **Notifications** | Telegram Bot API (free), Web Inbox fallback |
| **Background Jobs** | @nestjs/schedule (cron-based workers) |
| **CI/CD** | GitHub Actions (4-gate pipeline), Vercel (frontend) |
| **Testing** | Jest (255+ tests), Playwright (e2e) |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 22+
- PostgreSQL (or use SQLite for development)
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

# Generate Prisma client & run migrations
cd backend
npx prisma generate
npx prisma migrate dev

# Start development servers
cd ..
npm run dev
```

The app runs at:
- **Frontend:** http://localhost:3211
- **Backend API:** http://localhost:3210

---

## 🧪 Testing

```bash
# Run all backend tests (255+ test cases)
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
│ Role Match         │  25%   │ Exact title → 100, related → 60   │
│ Skill Match        │  30%   │ (matched + related) / required     │
│ Experience         │  15%   │ Required ≤ yours → 100             │
│ Location           │  15%   │ User priority tiers (H/M/L)        │
│ Employment Type    │   5%   │ Match = 100, ANY = 100             │
│ Salary             │   5%   │ Currency overlap or static FX      │
│ Freshness          │   5%   │ Exponential decay (τ = 72h)        │
└────────────────────┴────────┴────────────────────────────────────┘

Match Categories: 90-100 Excellent · 80-89 Strong · 70-79 Good
                  60-69 Possible    · 0-59 Low
```

---

## 🌍 Job Sources

### Ethiopia (Priority 1)
EthioJobs · EthioNGO Jobs · HaHuJobs · GeezJobs · ET Careers · ReliefWeb

### Remote (Priority 2)
Remotive · Arbeitnow · Jobicy · RemoteOK · Landing.jobs

### International (Priority 3)
ReliefWeb International · Telegram Channels · Company Career Pages

---

## 📁 Project Structure

```
jobhunterET/
├── frontend/              # Next.js 15 application
│   ├── app/               # App Router pages (20+ routes)
│   ├── components/        # UI components (shell, match carousel, etc.)
│   ├── lib/               # Auth, API store, i18n, utilities
│   └── styles/            # Tailwind + custom CSS
├── backend/               # NestJS API server
│   ├── src/
│   │   ├── modules/       # Feature modules (auth, matching, sources, etc.)
│   │   ├── common/        # Guards, decorators, types
│   │   └── prisma/        # Prisma service & schema
│   ├── prisma/            # Database schemas (PG + SQLite)
│   ├── scripts/           # Utility scripts (coverage, backfill)
│   └── test/              # Jest test suites (255+ tests)
├── docs/                  # Architecture docs, ops runbook
├── scripts/               # DB switching, dev utilities
└── .github/workflows/     # CI pipeline (lint, test, build, audit)
```

---

## 🏆 What This Project Demonstrates

- **Full-stack TypeScript** — end-to-end type safety across 20+ frontend routes and 15+ backend modules
- **Multi-tenant architecture** — per-user profile isolation, matching, and notification routing
- **Real-world scraping pipeline** — 11 source adapters with normalization, dedup, and quality scoring
- **Explainable AI/ML concepts** — deterministic 7-factor scoring with freshness decay
- **Production DevOps** — GitHub Actions CI (4 gates), Vercel deployment, SQLite/PostgreSQL switching
- **Telegram Bot integration** — inline keyboards, rate limiting, deep-link account linking
- **Security best practices** — JWT with token revocation, bcrypt, Helmet, RBAC, rate limiting
- **255+ automated tests** — unit tests, integration tests, and e2e coverage

---

## 📄 License

Private — All rights reserved.

---

<div align="center">

**Built with ❤️ in Ethiopia 🇪🇹**

*Making job search effortless for Ethiopian talent*

</div>
