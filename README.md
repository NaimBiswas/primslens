# PrismLens

Opencode-style PR review tool with cyberpunk glassmorphism UI and CLI.  
Analyzes every changed file across 6 dimensions: performance, security, readability, bugs, scalability, and best practices.

## Structure

```
prismlens/
├── app/                    # Next.js (App Router) — UI + API, same origin
│   ├── page.jsx             # Landing page ("/")
│   ├── code-review/page.jsx # Dashboard shell ("/code-review") — sidebar + tabs
│   ├── layout.jsx
│   └── api/
│       ├── review/route.js             # POST /api/review
│       ├── review/preview/route.js     # POST /api/review/preview
│       ├── review/post/route.js        # POST /api/review/post
│       ├── review/merge/route.js       # POST /api/review/merge
│       ├── chat/route.js               # POST /api/chat
│       ├── health/route.js             # GET /api/health
│       ├── automation/status/route.js  # GET /api/automation/status
│       └── webhooks/github/route.js    # POST /api/webhooks/github — automated PR-comment responder
├── components/
│   ├── CodeReviewPanel.jsx  # Dashboard's "Code Review" tab
│   ├── AutomationPanel.jsx  # Dashboard's "Automation" tab
│   └── ChatPanel.jsx
├── lib/
│   ├── api-client.js       # fetch wrapper used by the UI
│   ├── webhook-verify.js   # GitHub webhook signature verification
│   └── services/
│       ├── github.js       # GitHub API (fetch, post review, merge, reply)
│       ├── analyzer.js     # 6-dimension per-file review engine
│       └── automation.js   # webhook → analyze comment → reply pipeline
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
- **Automated PR-comment responder** — react to new comments on PRs assigned to or authored by you, automatically (see below)

## Automation

Once configured, PrismLens can watch your PRs and respond to new comments on its own — no need to open the app. It always **proposes**, never commits on its own: a fix preview when the comment implies a code change, a direct answer otherwise.

The **Automation tab** in the dashboard (`/code-review`) shows live setup status — which env vars are set, the account being watched, the webhook URL (copyable), and a recent-activity feed — so you don't have to guess whether it's working. Setup itself is still two manual steps outside the app:

1. Set two env vars (in addition to `GITHUB_TOKEN`, which the automation reuses):
   ```bash
   GITHUB_WEBHOOK_SECRET=<a secret you make up>
   ```
2. Get `/api/webhooks/github` reachable from the internet — deploy PrismLens somewhere public, or run a tunnel (e.g. `ngrok http 3000`) for local testing.
3. On each repo you want watched: **Settings → Webhooks → Add webhook** (the Automation tab shows the exact URL and steps)
   - Payload URL: `https://<your-host>/api/webhooks/github`
   - Content type: `application/json`
   - Secret: the same value as `GITHUB_WEBHOOK_SECRET`
   - Events: **Issue comments** and **Pull request review comments**

PrismLens reacts to a comment only when the PR is assigned to, or authored by, the account `GITHUB_TOKEN` belongs to — and it always ignores comments it posted itself, so it never replies to its own replies.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/review` | Full PR review |
| POST | `/api/review/preview` | Lightweight PR metadata |
| POST | `/api/review/post` | Post review as GitHub comment |
| POST | `/api/review/merge` | Merge the pull request |
| GET | `/api/health` | Server health check |
| POST | `/api/webhooks/github` | Automated PR-comment responder (called by GitHub, not the client) |

Full API reference: [`docs/api.md`](docs/api.md)
