# PrismLens

Opencode-style PR review tool with cyberpunk glassmorphism UI and CLI.  
Analyzes every changed file across 6 dimensions: performance, security, readability, bugs, scalability, and best practices.

## Structure

```
prismlens/
├── client/                # React + Vite SPA
│   ├── src/App.jsx        # Cyberpunk UI with category review display
│   └── src/services/api.js
├── server/                # Express API (port 3000)
│   ├── routes/review.js   # /review, /review/post, /review/merge, /health
│   └── services/
│       ├── github.js      # GitHub API (fetch, post review, merge)
│       └── analyzer.js    # 6-dimension per-file review engine
├── cmd/index.js           # CLI tool (imports analyzer)
├── docs/                  # Architecture + API docs
└── package.json
```

## Quick Start

```bash
npm install
cd client && npm install && cd ..

# Dev mode (two terminals)
npm run client:dev     # Vite HMR on :5173
npm run server         # Express on :3000

# Production
npm run deploy         # Build React + start Express → localhost:3000

# CLI
npm run review https://github.com/user/repo/pull/17
```

## Features

- **6-dimension analysis** — every file checked for performance, security, readability, bugs, scalability, and best practices
- **Severity levels** — critical, high, medium, low with visual badges
- **Post to PR** — submit the review as a GitHub PR review comment (professional format with performance suggestions)
- **Merge PR** — one-click merge from the UI (shown when verdict is APPROVE)
- **CLI** — terminal reviews with `--json` and `-o file` options

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/review` | Full PR review |
| POST | `/api/review/preview` | Lightweight PR metadata |
| POST | `/api/review/post` | Post review as GitHub comment |
| POST | `/api/review/merge` | Merge the pull request |
| GET | `/api/health` | Server health check |

Full API reference: [`docs/api.md`](docs/api.md)
