# 🔭 PrismLens

**Opencode-style PR analysis — cyberpunk glassmorphism UI + CLI.**

Analyze GitHub PRs for code quality, null safety, error handling, and more.

---

## 📦 Structure

```
prismlens/
├── client/                # React + Vite SPA
│   ├── src/App.jsx        # Cyberpunk UI
│   └── src/services/api.js
├── server/                # Express API (port 3000)
│   ├── routes/review.js   # POST /api/review
│   └── services/
│       ├── github.js      # GitHub API
│       └── analyzer.js    # Opencode engine
├── cmd/index.js           # CLI tool
├── docs/                  # Architecture + API docs
└── package.json
```

## 🚀 Quick Start

```bash
npm install
npm run client:install

# Option A: Dev mode (hot reload)
npm run client:dev     # Terminal 1 — Vite on :5173
npm run server         # Terminal 2 — Express on :3000

# Option B: Production
npm run build && npm run server
# → http://localhost:3000

# CLI
npm run review https://github.com/user/repo/pull/17
```

## 📡 API

`POST /api/review` — body: `{ prUrl, token }`

Returns `{ meta, strengths, concerns, bugs, info, recommendation, files }`.

`GET /api/health` — server health check.

Full docs: [`docs/api.md`](docs/api.md)

## 🎨 Design

Cyberpunk glassmorphism with neon pink/blue/purple palette, frosted glass panels, animated gradients, and glitch effects.
