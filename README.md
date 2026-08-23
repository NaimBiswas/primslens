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
│       ├── model/route.js              # GET/POST /api/model
│       ├── providers/route.js          # GET/POST/DELETE /api/providers
│       ├── review/describe/route.js    # POST /api/review/describe — auto-generated PR description
│       ├── review/label/route.js       # POST /api/review/label — size/risk labels
│       ├── feedback/route.js           # POST /api/feedback — 👍/👎 on a finding
│       └── webhooks/github/route.js    # POST /api/webhooks/github — automated PR-comment responder
├── components/
│   ├── CodeReviewPanel.jsx  # Dashboard's "Code Review" tab
│   ├── AutomationPanel.jsx  # Dashboard's "Automation" tab
│   ├── ModelPanel.jsx       # Dashboard's "Model" tab (models + provider connections)
│   └── ChatPanel.jsx
├── lib/
│   ├── api-client.js       # fetch wrapper used by the UI
│   ├── webhook-verify.js   # GitHub webhook signature verification
│   └── services/
│       ├── github.js       # GitHub API (fetch, post review, merge, reply, describe, label)
│       ├── analyzer.js     # 6-dimension per-file review engine + orchestrates config/dep-scan
│       ├── automation.js   # webhook → analyze comment → reply pipeline
│       ├── models.js       # lists opencode's free models + connected-provider models
│       ├── providers.js    # models.dev catalog + opencode's credential store
│       ├── review-config.js # loads per-repo .prismlens.json (ignore paths, severity overrides, disabled checks)
│       ├── dependency-scan.js # OSV.dev vulnerability scan for package.json
│       └── feedback.js     # 👍/👎 log, feeds "avoid patterns like this" back into the AI prompt
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
- **Post to PR** — submit the review as a GitHub PR review comment, with inline `suggestion` code blocks (one-click-apply diffs) across every category, not just performance
- **Auto-generated PR description** — a **Describe** button replaces the PR body with a file-by-file summary + review snapshot generated from the same analysis
- **Size/risk labels** — a **Label** button derives `size/*` and `risk/*` labels from the diff size and verdict and applies them (creating the labels on the repo first if they don't exist)
- **Missing-test detection with a concrete suggestion** — flags a PR that adds substantial new code but touches no test file, folded into Best Practices rather than a new dimension; the finding includes a real, language-aware test skeleton (JS/TS, Python, Go, Ruby, Java, Rust) for the largest changed file, not just "add tests"
- **Codebase-aware AI review** — the AI reviewer sees the full content of every changed file (not just the diff hunk) plus a repo-wide file-tree overview, so it can catch things pure change-detection misses: duplicated logic that already exists elsewhere, a change that's inconsistent with the surrounding function, a file landing outside the project's own layout conventions
- **Dependency vulnerability scanning** — when a PR touches `package.json`, its dependencies are checked against [OSV.dev](https://osv.dev)'s free public database; findings land in Security with the fixed version to upgrade to
- **Learns what not to flag** — 👍/👎 on any finding; recent 👎s are fed back into future AI reviews as "don't flag patterns like this again"
- **Custom review config** — an optional `.prismlens.json` in the reviewed repo can ignore paths, override severities, or disable whole categories per-repo
- **Documentation generation** — ask the chat to document a file or function; same preview-then-confirm-then-commit flow as a fix
- **Merge PR** — one-click merge from the UI (shown when verdict is APPROVE)
- **CLI** — terminal reviews with `--json` and `-o file` options
- **Automated PR-comment responder** — react to new comments on PRs assigned to or authored by you, automatically (see below)
- **Free model picker** — choose which of opencode's own free models (no API key, no cost) powers review and chat, from the dashboard's Model tab
- **Bring your own provider** — connect any opencode-supported provider (OpenAI, Anthropic, Google, ~190 more) with an API key and pick from its models too, same tab
- **PR status at a glance** — status (open/merged/closed/draft) and assignees shown right in the results view

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

## Model Selection

opencode ships several models on its own `opencode` provider that are free to use — no API key, no cost. The dashboard's **Model tab** lists them and lets you pick one; the choice applies to every review, chat, and automated reply from then on, and persists across restarts. Leaving it on "opencode default" uses whatever opencode itself is configured to default to.

opencode can also talk to any of the ~190 providers it supports (OpenAI, Anthropic, Google, Groq, and the rest) — the same tab's **Providers** section lets you search for one and connect it with an API key. The key goes straight into opencode's own credential store, not PrismLens's; once connected, that provider's models (real pricing shown, never hidden as free) join the picker above. Disconnect a provider the same way, from the chip next to its name.

## Custom Review Config

Drop a `.prismlens.json` at the root of a repo you review to customize how PrismLens treats it — no PrismLens-side setup, it's read straight from the PR's branch on each review:

```json
{
  "ignorePaths": ["dist/**", "**/*.generated.ts"],
  "severityOverrides": { "readability": "low" },
  "disabledChecks": ["scalability"]
}
```

- `ignorePaths` — glob patterns (`*` within a path segment, `**` across segments); matched files are skipped entirely (they still show in the file list, just aren't analyzed).
- `severityOverrides` / `disabledChecks` — keyed by the same 6 categories the review already groups findings into: `performance`, `security`, `readability`, `bugs`, `scalability`, `best-practices`.

No file, invalid JSON, or an unrecognized shape all just mean "no customization" — never an error.

## Dependency Scanning

If a PR touches `package.json`, PrismLens fetches it from the PR's branch and checks every `dependencies`/`devDependencies` entry against [OSV.dev](https://osv.dev)'s free public vulnerability database (no API key needed). Any hit becomes a `security`-category finding with the CVE/GHSA id, a summary, and the version to upgrade to. npm only for now — other ecosystems (pip, go.mod, ...) aren't wired up yet. A scan failure (OSV unreachable, malformed manifest) never blocks the rest of the review — it's silently skipped.

## Feedback Loop

Every finding has 👍/👎 buttons. This isn't a hosted learning system — there's no database, no retraining — but recent 👎s (stored locally in `.prismlens-feedback.json`) are included in the AI's review prompt as "reviewers marked findings phrased like these unhelpful, don't repeat the pattern." It's a small, local nudge toward less noise over time, not a promise the AI won't ever flag something similar again.

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

## Roadmap

[`docs/roadmap.md`](docs/roadmap.md) documents the outcome of a competitive feature analysis against other AI PR-review tools — what was built this round and, just as importantly, what was deliberately left out and why (multi-provider git, IDE extension, an analytics dashboard, code graphs, a multi-agent architecture).
