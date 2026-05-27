# 🔭 PrismLens — Session Context

> **Project:** Opencode-style PR review tool with cyberpunk glassmorphism UI  
> **Location:** `C:\Users\88017\Desktop\prismlens`  
> **Stack:** React + Vite (client) | Express (server) | Node CLI (cmd)  

---

## ✅ Done This Session

- PR review of `Laststop-live/Bintech.ndc/pull/17` (Feat(order Change))
- Built CLI tool (`cmd/index.js`) — reviews PRs from terminal
- Built Express server (`server/index.js`) — `POST /api/review`, `GET /api/health`, `POST /api/review/preview`
- Built analyzer engine (`server/services/analyzer.js`) — opencode-style file group analysis
- Built GitHub service (`server/services/github.js`) — API fetch with token auth
- Built React client (`client/src/App.jsx`) — cyberpunk glassmorphism UI
- Added full cyberpunk CSS (`client/src/cyberpunk.css`) — neon colors, glass panels, animations
- Renamed project from `github-code-reviewer` to **`prismlens`**
- docs/ folder with `architecture.md` and `api.md`

## 📁 Structure

```
prismlens/
├── client/                         # React + Vite SPA
│   ├── index.html                  # Entry HTML (title: PrismLens)
│   ├── vite.config.js              # Proxy /api → localhost:3000
│   ├── package.json                # React 19, Vite 6
│   └── src/
│       ├── main.jsx                # ReactDOM.createRoot
│       ├── App.jsx                 # Full app: form, loading, results, error
│       ├── cyberpunk.css           # All glassmorphism styles
│       └── services/
│           └── api.js              # reviewPR(prUrl, token) → POST /api/review
├── server/                         # Express API
│   ├── index.js                    # Port 3000, serves client/dist, /api/*
│   ├── routes/
│   │   └── review.js               # POST /api/review, /preview, GET /health
│   └── services/
│       ├── github.js               # fetchPR, fetchPRFiles, parsePRUrl
│       └── analyzer.js             # groupFiles → analyze* → build report
├── cmd/                            # CLI
│   └── index.js                    # "prismlens review <url>" — imports analyzer
├── docs/
│   ├── architecture.md             # Full architecture with data flow diagrams
│   └── api.md                      # REST API reference with curl examples
├── package.json                    # Root: server + CLI deps, build scripts
├── .env.example
└── README.md
```

## 🚀 Scripts

| Command | What it does |
|---------|-------------|
| `npm run server` | Start Express on :3000 (serves built React) |
| `npm run client:dev` | Vite dev server with HMR on :5173 |
| `npm run client:build` | Build React to `client/dist/` |
| `npm run build` | Build React |
| `npm run deploy` | Build React + start server |
| `npm run review <url>` | CLI review |
| `npm run review <url> -- --json` | CLI JSON output |
| `npm run review <url> -- -o report.md` | CLI save to file |

## 🔌 Client-Server Flow

```
Client (React on :5173 or served from :3000)
  │
  │  POST /api/review { prUrl, token }
  ▼
Server: routes/review.js
  │
  ├── github.fetchPR(prUrl, token)      → GitHub API
  ├── github.fetchPRFiles(prUrl, token) → GitHub API
  │
  ▼
  analyzer.analyzePR(prData, files)
  │  ├── groupFiles(files)              → services, controllers, mappers, utils, builders
  │  ├── analyzeServices(groups)        → TODOs, null safety
  │  ├── analyzeControllers(groups)     → async patterns, response messages
  │  ├── analyzeMappers(groups)         → extract/transform, optional chaining
  │  ├── analyzeUtils(groups)           → exports, shared helpers
  │  ├── analyzeBuilders(groups)        → optional chaining density, XML templates
  │  └── buildReport(prData)            → strengths, concerns, bugs, info, recommendation
  │
  ▼
  JSON → { meta, strengths, concerns, bugs, info, recommendation, files }
```

## 📡 API Response Shape

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
  "strengths": [ /* type: STRENGTH */ ],
  "concerns": [ /* type: CONCERN */ ],
  "bugs": [],
  "info": [],
  "recommendation": {
    "verdict": "APPROVE" | "REVIEW" | "REJECT",
    "label": "✅ Approve" | "⚠️ Review Required" | "🔴 Reject or Rework",
    "reason": "No issues found..."
  },
  "files": [ { "name": "...", "additions": 3, "deletions": 3, "patch": "..." } ]
}
```

## 🎨 CSS Architecture

- **Single file:** `client/src/cyberpunk.css`
- **Variables:** `--neon-pink`, `--neon-blue`, `--neon-purple`, `--neon-green`, `--neon-red`, `--dark-bg`, `--glass-bg`, `--glass-border`, `--text-primary`, `--text-secondary`
- **Animations:** `bgPulse` (15s), `glowPulse` (3s), `rotate` (20s), `spin` (1s)
- **Fonts:** Orbitron (headers), JetBrains Mono (body) — loaded via Google Fonts in `client/index.html`
- **Responsive:** 768px tablet breakpoint, 480px mobile breakpoint

## 🧠 Key Decisions

1. **Token in request body** not headers — simple for MVP, could move to `Authorization` header later
2. **Same analyzer** used by both CLI and server — `server/services/analyzer.js` imported by `cmd/index.js`
3. **ES Modules** throughout — `"type": "module"` in root package.json
4. **No database** — ephemeral, no PR data stored
5. **Token in localStorage** under `PRISMLENS_TOKEN` key — not cookies
6. **Vite dev proxy** — `/api` requests forwarded from `:5173` to `:3000`

## 🐛 Known Issues / TODOs

- [ ] Token validation: no check that token has `repo` scope before making requests
- [ ] Rate limiting: no `express-rate-limit` on server
- [ ] Error display: uses `alert()` — replace with in-page toast/notification component
- [ ] Empty state: no "no results" state for successful PRs with zero findings
- [ ] File diff: `patch` field is returned but not rendered in UI
- [ ] Test coverage: no tests for analyzer or routes
- [ ] Express 5 catch-all: uses `app.use()` middleware instead of `app.get('*')` — works but may need adjustment
- [ ] CLI `--output` file: implemented but not thoroughly tested
- [ ] CORS: `cors({ origin: '*' })` is permissive — restrict for production

## 🔧 Environment

```env
GITHUB_TOKEN=ghp_xxxxxx    # Required (repo scope)
PORT=3000                   # Optional (default)
```

## 📝 Quick Start for Next Session

```bash
# 1. Navigate
cd C:\Users\88017\Desktop\prismlens

# 2. Install
npm install
cd client && npm install && cd ..

# 3. Run (choose one)
npm run deploy              # Production: build React + start Express on :3000
# Or split terminals:
npm run client:dev          # Dev: Vite HMR on :5173
npm run server              # Dev: Express on :3000

# 4. CLI
npm run review https://github.com/user/repo/pull/17
```
