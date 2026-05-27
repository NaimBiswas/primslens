# Architecture Overview

## Project Structure

```
prismlens/
├── client/                         # React + Vite SPA (:5173 dev / served from :3000)
│   ├── index.html                  # Google Fonts, app title
│   ├── vite.config.js              # Proxy /api → localhost:3000
│   ├── package.json                # React 19, Vite 6
│   └── src/
│       ├── main.jsx                # ReactDOM.createRoot
│       ├── App.jsx                 # Form → results → actions (post/merge)
│       ├── cyberpunk.css           # Glassmorphism with neon palette
│       └── services/
│           └── api.js              # reviewPR, postReviewToPR, mergePR
├── server/                         # Express API on :3000
│   ├── index.js                    # Middleware (helmet, cors), SPA fallback
│   ├── routes/
│   │   └── review.js               # /review, /review/preview, /review/post, /review/merge, /health
│   └── services/
│       ├── github.js               # fetchPR, fetchPRFiles, postPRReview, mergePR
│       └── analyzer.js             # 6-dimension per-file review engine
├── cmd/
│   └── index.js                    # CLI — imports analyzer, supports --json, -o file
├── docs/
│   ├── architecture.md
│   └── api.md
├── package.json                    # ES modules, server + CLI deps
└── .env.example
```

## Three-Tier Architecture

```
┌──────────┐     HTTP/JSON     ┌──────────┐     HTTPS    ┌──────────┐
│          │ ─────────────────> │          │ ────────────> │          │
│  Client  │   POST /api/*      │  Server  │   GitHub API  │  GitHub  │
│ (Browser)│ <───────────────── │ (Node)   │ <──────────── │          │
│          │   JSON Response    │          │   JSON Data   │          │
└──────────┘                   └──────────┘               └──────────┘
```

### 1. Client (`client/`)
- **React + Vite SPA** with cyberpunk glassmorphism UI
- Input form for PR URL and GitHub token
- Displays review results grouped by 6 categories (Performance, Security, Readability, Bugs, Scalability, Best Practices)
- Shows severity badges (critical/high/medium/low) and type badges (Bug/Concern/Strength/Info)
- Actions: **Post to PR** (submits review as GitHub PR review comment), **Merge PR** (merges the PR, shown only on APPROVE)
- Token persisted in `localStorage` under `PRISMLENS_TOKEN`
- Dev mode: Vite on :5173 with proxy to :3000; Production: served from Express

### 2. Server (`server/`)
- **Express.js** on port 3000
- Serves built client from `client/dist/`
- REST API endpoints for review analysis, posting reviews, and merging PRs
- Proxies all GitHub API calls (token stays server-side)
- Imports same analyzer module as CLI

### 3. CLI (`cmd/`)
- **Node.js terminal tool** using `commander`
- Imports `analyzePR` from server services directly
- Options: `--json` (raw JSON), `-o <file>` (markdown report export)
- Output grouped by the 6 categories with severity breakdown

## Analysis Pipeline

The analysis engine in `server/services/analyzer.js` evaluates every changed file across 6 dimensions:

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Fetch PR    │     │  Per-File         │     │  Build Report    │
│  from GitHub │ ──> │  6-Dimension      │ ──> │  with Categories │
│  (github.js) │     │  Analysis         │     │  + Recommendation│
└─────────────┘     └──────────────────┘     └──────────────────┘
```

### Fetch Phase (`github.js`)
- Parse PR URL → `(owner, repo, prNumber)`
- `GET /repos/{owner}/{repo}/pulls/{number}` → PR metadata
- `GET /repos/{owner}/{repo}/pulls/{number}/files` → file diffs

### Analysis Phase (`analyzer.js`)

Each file's added lines are analyzed by 6 check functions:

| Dimension | Function | Example Patterns Detected |
|-----------|----------|--------------------------|
| Performance | `checkPerformance` | Nested loops, spread in loops, console.log, heavy JSON |
| Security | `checkSecurity` | eval/innerHTML, hardcoded secrets, SQL injection, user input interpolation |
| Readability | `checkReadability` | Long lines, deep nesting, magic numbers, complex ternaries, large change blocks |
| Bugs | `checkBugs` | Loose equality, missing optional chaining, unhandled promises, NaN comparison |
| Scalability | `checkScalability` | async forEach (N+1), sync I/O, in-memory ops on large data, missing listener cleanup |
| Best Practices | `checkBestPractices` | TODO/FIXME, deprecated APIs, missing try-catch, missing input validation, missing React keys |

Each finding includes: `type` (BUG/CONCERN/STRENGTH/INFO), `severity` (critical/high/medium/low), `category`, `issue` description, and `recommendation`.

### Report Building Phase (`analyzer.js` → `analyzePR()`)
- Aggregates all per-file findings
- Categorizes by both type (`strengths`, `concerns`, `bugs`, `info`) and review dimension (`performance`, `security`, `readability`, `bugs_cat`, `scalability`, `best_practices`)
- Computes recommendation: `APPROVE` / `REVIEW` / `REJECT` based on severity counts
- Attaches file list with diff stats

## Data Flow

```
Client (Browser)
     │
     │ POST /api/review { prUrl, token }
     ▼
Server Routes (review.js)
     │
     ├── github.fetchPR(prUrl, token) ──────→ GitHub API
     │                                            │
     │    <── PR metadata (title, author, ...)    │
     │                                            │
     ├── github.fetchPRFiles(prUrl, token) ────→ GitHub API
     │                                            │
     │    <── File diffs (patch, stats, ...)      │
     │                                            │
     ▼
Server Analyzer (analyzer.js)
     │
     ├── For each file:
     │     ├── checkPerformance()  → ⚡ findings
     │     ├── checkSecurity()     → 🔒 findings
     │     ├── checkReadability()  → 📖 findings
     │     ├── checkBugs()         → 🐛 findings
     │     ├── checkScalability()  → 📊 findings
     │     └── checkBestPractices()→ ✅ findings
     │
     ▼
analyzePR(prData, files) → Structured Report
     │
     │ JSON Response (meta, categories, recommendation, files)
     ▼
Client renders report with category overview + detailed sections
     │
     │ (optional) User clicks "Post to PR" → POST /api/review/post
     │ (optional) User clicks "Merge PR"   → POST /api/review/merge
     ▼
GitHub API — review comment or merge
```

## Post-to-PR Flow (`github.js` → `generateReviewBody()`)

Formatting the review as a GitHub PR review comment:

- When verdict is `APPROVE` and zero findings → short message: "All looks good. No issues found."
- When there are findings → full breakdown with Overview, per-category detail, and Recommendation
- Performance items include inline ```suggestion code blocks showing before/after patterns
- Event mapped from verdict: APPROVE → `APPROVE`, REJECT → `REQUEST_CHANGES`, default → `COMMENT`

## Security Model

- Token passed in request body (not headers) — simple for MVP
- All GitHub API calls made server-side — token never exposed to client
- Cors permissive (`origin: '*'`) — restrict for production
- Helmet middleware for security headers
- No database — all processing is ephemeral
- Token stored in `localStorage` (not cookies) on the client

## Key Design Decisions

1. **Per-file, multi-dimension analysis** — every file is evaluated against all 6 dimensions, not just file-type-specific checks
2. **Same analyzer for CLI and Web** — `analyzer.js` imported by both `server/` and `cmd/`
3. **ES Modules** throughout — `"type": "module"` in root package.json
4. **No database** — ephemeral, no PR data stored
5. **Action buttons in UI** — Post to PR and Merge PR available from the results view
6. **Vite dev proxy** — `/api` requests forwarded from `:5173` to `:3000`
