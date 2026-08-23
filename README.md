# PrismLens

Opencode-style PR review tool with cyberpunk glassmorphism UI and CLI.  
Analyzes every changed file across 6 dimensions: performance, security, readability, bugs, scalability, and best practices.

## Structure

```
prismlens/
├── app/                    # Next.js (App Router) — UI + API, same origin
│   ├── page.jsx            # Cyberpunk UI with category review display
│   ├── layout.jsx
│   └── api/
│       ├── review/route.js         # POST /api/review
│       ├── review/preview/route.js # POST /api/review/preview
│       ├── review/post/route.js    # POST /api/review/post
│       ├── review/merge/route.js   # POST /api/review/merge
│       ├── chat/route.js           # POST /api/chat
│       └── health/route.js         # GET /api/health
├── components/ChatPanel.jsx
├── lib/
│   ├── api-client.js       # fetch wrapper used by the UI
│   └── services/
│       ├── github.js       # GitHub API (fetch, post review, merge)
│       └── analyzer.js     # 6-dimension per-file review engine
├── cmd/index.js            # CLI tool (imports analyzer directly)
├── docs/                   # Architecture + API docs
└── package.json
```

## Quick Start

```bash
npm install

# Dev mode — one process, UI + API together
npm run dev             # http://localhost:3000

# Production
npm run build && npm run start

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
