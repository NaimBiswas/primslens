# PrismLens — Session Context

> **Project:** Opencode-style PR review tool with cyberpunk glassmorphism UI  
> **Location:** `C:\Users\88017\Desktop\prismlens`  
> **Stack:** React + Vite (client) | Express (server) | Node CLI (cmd)  

---

## Done This Session

- Rewrote analyzer from group-based to **6-dimension per-file analysis** (performance, security, readability, bugs, scalability, best-practices) with severity levels (critical/high/medium/low)
- Updated UI to display results grouped by category with severity badges and type badges
- Updated CLI output with new category grouping
- Added **Post to PR** button — submits formatted review as GitHub PR review comment
- Professional PR comment format (no emojis, senior-engineer tone) with ```suggestion code blocks for performance findings
- Clean approval message ("All looks good. No issues found.") for zero-finding PRs
- Added **Merge PR** button — one-click merge from UI (shown on APPROVE verdict)
- Improved GitHub API error extraction (reads `errors[0].message` for 422 responses)
- Added `client/dist/` to `.gitignore`
- Updated all docs (architecture.md, api.md, README.md, SESSION.md)
- git: 6 commits on master

## Structure

```
prismlens/
├── client/                         # React + Vite SPA
│   ├── index.html                  # Orbitron + JetBrains Mono fonts
│   ├── vite.config.js              # Proxy /api → localhost:3000
│   ├── package.json                # React 19, Vite 6
│   └── src/
│       ├── main.jsx                # ReactDOM.createRoot
│       ├── App.jsx                 # Form → results (6 categories) → actions (post/merge)
│       ├── cyberpunk.css           # Glassmorphism, neon palette, severity badges
│       └── services/
│           └── api.js              # reviewPR, postReviewToPR, mergePR
├── server/                         # Express API
│   ├── index.js                    # Port 3000, helmet, cors, serves client/dist
│   ├── routes/
│   │   └── review.js               # /review, /preview, /post, /merge, /health
│   └── services/
│       ├── github.js               # fetchPR, fetchPRFiles, postPRReview, mergePR
│       └── analyzer.js             # 6-dimension per-file analysis
├── cmd/                            # CLI
│   └── index.js                    # "prismlens review <url>" — category output
├── docs/
│   ├── architecture.md
│   └── api.md
├── package.json
├── .env.example
└── README.md
```

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run server` | Start Express on :3000 |
| `npm run client:dev` | Vite dev server with HMR on :5173 |
| `npm run client:build` | Build React to `client/dist/` |
| `npm run build` | Build React |
| `npm run deploy` | Build React + start server |
| `npm run review <url>` | CLI review |
| `npm run review <url> -- --json` | CLI JSON output |
| `npm run review <url> -- -o report.md` | CLI save to file |

## Analysis Flow

```
Client (React on :5173 or served from :3000)
  │
  │  POST /api/review { prUrl, token }
  ▼
Server: routes/review.js
  │
  ├── github.fetchPR(prUrl, token)          → GitHub API
  ├── github.fetchPRFiles(prUrl, token)     → GitHub API
  │
  ▼
  analyzer.analyzePR(prData, files)
  │  For each file:
  │    ├── checkPerformance()     → nested loops, spread, console, JSON
  │    ├── checkSecurity()        → eval, innerHTML, secrets, SQL injection
  │    ├── checkReadability()     → line length, nesting, magic numbers
  │    ├── checkBugs()            → ==, null access, unhandled promises, NaN
  │    ├── checkScalability()     → async forEach, sync I/O, in-memory ops
  │    └── checkBestPractices()   → TODOs, deprecated APIs, missing validation
  │
  ▼
  JSON → { meta, strengths, concerns, bugs, info,
           performance, security, readability, bugs_cat, scalability,
           best_practices, recommendation, files }

  (optional) POST /api/review/post   → GitHub PR review comment
  (optional) POST /api/review/merge  → GitHub PR merge
```

## API Response Shape

```json
{
  "meta": {
    "prTitle": "Feat(order Change)...",
    "prAuthor": "NaimBiswas",
    "prUrl": "https://github.com/...",
    "prNumber": 17,
    "repo": "user/repo",
    "branch": "feature/order-change",
    "stats": { "additions": 245, "deletions": 53, "filesChanged": 6 }
  },
  "reviews": [ /* flat list of all findings */ ],
  "strengths": [],
  "concerns": [],
  "bugs": [],
  "info": [],
  "performance": [],
  "security": [],
  "readability": [],
  "bugs_cat": [],
  "scalability": [],
  "best_practices": [],
  "recommendation": {
    "verdict": "APPROVE" | "REVIEW" | "REJECT",
    "label": "Approve" | "Review Required" | "Reject or Rework",
    "reason": "Fix 2 high-severity bug(s) before merging"
  },
  "files": [ { "name": "...", "additions": 3, "deletions": 3, "patch": "..." } ]
}
```

## CSS Architecture

- **Single file:** `client/src/cyberpunk.css`
- **Variables:** `--neon-pink`, `--neon-blue`, `--neon-purple`, `--neon-green`, `--neon-red`, `--dark-bg`, `--glass-bg`, `--glass-border`, `--text-primary`, `--text-secondary`
- **Animations:** `bgPulse` (15s), `glowPulse` (3s), `rotate` (20s), `spin` (1s)
- **Fonts:** Orbitron (headers), JetBrains Mono (body)
- **New additions:** `.cat-badge` (category overview), `.sev-badge` (severity indicators), `.btn-post` (post to PR), `.btn-merge` (merge PR)
- **Responsive:** 768px tablet breakpoint, 480px mobile breakpoint

## Key Decisions

1. **Per-file, multi-dimension analysis** — every file checked against all 6 dimensions, not file-type-specific checks
2. **Same analyzer** used by both CLI and server — `server/services/analyzer.js` imported by `cmd/index.js`
3. **ES Modules** throughout — `"type": "module"` in root package.json
4. **No database** — ephemeral, no PR data stored
5. **Token in localStorage** under `PRISMLENS_TOKEN` key — not cookies
6. **Vite dev proxy** — `/api` requests forwarded from `:5173` to `:3000`
7. **Actions from results** — Post to PR and Merge PR buttons in the results view

## Known Issues / TODOs

- [ ] Token validation: no check that token has `repo` scope before making requests
- [ ] Rate limiting: no `express-rate-limit` on server
- [ ] Error display: uses `alert()` — replace with in-page toast/notification component
- [ ] File diff: `patch` field is returned but not rendered in UI
- [ ] Test coverage: no tests for analyzer or routes
- [ ] Express 5 catch-all: uses `app.use()` middleware instead of `app.get('*')`
- [ ] CLI `--output` file: implemented but not thoroughly tested
- [ ] CORS: `cors({ origin: '*' })` is permissive — restrict for production

## Environment

```env
GITHUB_TOKEN=ghp_xxxxxx    # Required (repo scope)
PORT=3000                   # Optional (default)
```

## Quick Start for Next Session

```bash
cd C:\Users\88017\Desktop\prismlens

npm install
cd client && npm install && cd ..

npm run deploy              # Production: build React + Express on :3000
# Or split terminals:
npm run client:dev          # Dev: Vite HMR on :5173
npm run server              # Dev: Express on :3000

# CLI
npm run review https://github.com/user/repo/pull/17
```
