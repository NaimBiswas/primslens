# Architecture Overview

## Project Structure

```
prismlens/
├── app/                             # Next.js (App Router) — UI + API, one process on :3000
│   ├── layout.jsx                   # Google Fonts, metadata (title/icons/manifest)
│   ├── page.jsx                     # Landing page ("/")
│   ├── globals.css                  # Glassmorphism with neon palette
│   ├── landing.module.css           # Landing-page-specific styles
│   ├── code-review/page.jsx         # Dashboard shell ("/code-review") — sidebar + tab switch, "use client"
│   ├── code-review/dashboard.module.css # Sidebar/status/activity styles, shared by the shell and AutomationPanel
│   └── api/
│       ├── review/route.js          # POST /api/review
│       ├── review/preview/route.js  # POST /api/review/preview
│       ├── review/post/route.js     # POST /api/review/post
│       ├── review/merge/route.js    # POST /api/review/merge
│       ├── chat/route.js            # POST /api/chat
│       ├── health/route.js          # GET /api/health
│       ├── automation/status/route.js # GET /api/automation/status — for the Automation dashboard tab
│       ├── model/route.js           # GET/POST /api/model — for the Model dashboard tab
│       ├── providers/route.js       # GET/POST/DELETE /api/providers — connect other opencode providers
│       ├── review/describe/route.js # POST /api/review/describe — auto-generated PR description
│       ├── review/label/route.js    # POST /api/review/label — size/risk labels
│       ├── feedback/route.js        # POST /api/feedback — 👍/👎 on a finding
│       └── webhooks/github/route.js # POST /api/webhooks/github — automated PR-comment responder
├── components/
│   ├── CodeReviewPanel.jsx          # The review tool itself (dashboard's "Code Review" tab), "use client"
│   ├── AutomationPanel.jsx          # Automation status/config/activity (dashboard's "Automation" tab), "use client"
│   ├── ModelPanel.jsx               # Free-model picker (dashboard's "Model" tab), "use client"
│   ├── ChatPanel.jsx                # Chat overlay, "use client"
│   └── Reveal.jsx                   # Scroll-reveal utility, "use client"
├── lib/
│   ├── api-client.js                # reviewPR, postReviewToPR, mergePR, describePR, labelPR, submitFeedback (fetch wrapper)
│   ├── api-error.js                 # shared GitHub-error → HTTP-status mapping
│   ├── webhook-verify.js            # GitHub webhook signature verification + event filtering
│   └── services/
│       ├── github.js                # fetchPR, fetchPRFiles, postPRReview, mergePR, updatePRDescription, computeLabels/applyLabels, reply/comment helpers
│       ├── analyzer.js              # 6-dimension per-file review engine; orchestrates review-config, dependency-scan, and feedback
│       ├── chat.js                  # opencode-backed chat, spawns opencode CLI
│       ├── automation.js            # webhook → analyze comment → reply pipeline
│       ├── models.js                # lists opencode's free models + models from connected providers
│       ├── model-config.js          # persists the selected model (.prismlens-config.json)
│       ├── providers.js             # models.dev catalog + opencode's auth.json (connect/disconnect providers)
│       ├── review-config.js         # loads per-repo .prismlens.json (ignore paths, severity overrides, disabled checks)
│       ├── dependency-scan.js       # OSV.dev vulnerability scan for package.json dependencies
│       ├── feedback.js              # 👍/👎 log (.prismlens-feedback.json), feeds "avoid patterns like this" back into the AI prompt
│       ├── test-skeleton.js         # language-aware test skeleton for the missing-test finding
│       └── shared.js                # locates the opencode binary
├── cmd/
│   └── index.js                     # CLI — imports lib/services/analyzer.js directly, supports --json, -o file
├── docs/
│   ├── architecture.md
│   └── api.md
├── next.config.js                   # Security headers (replaces Helmet)
├── package.json                     # ES modules, Next.js + CLI deps
└── .env.example
```

## Architecture

```
┌──────────┐     HTTP/JSON     ┌──────────────┐    HTTPS    ┌──────────┐
│          │ ─────────────────> │              │ ───────────> │          │
│  Browser │   POST /api/*      │  Next.js     │  GitHub API  │  GitHub  │
│          │ <───────────────── │  (Node)      │ <─────────── │          │
│          │   JSON Response    │              │  JSON Data   │          │
└──────────┘                   └──────────────┘              └──────────┘
```

One Next.js process serves both the UI (`app/page.jsx`) and the JSON API (`app/api/**/route.js`) from the same origin on port 3000 — no separate dev server, no `/api` proxy.

### 1. UI (`app/`, `components/`)
- **Next.js App Router**, cyberpunk glassmorphism UI. `/` is a marketing landing page; `/code-review` is a dashboard — a left sidebar (Code Review / Automation) plus the active panel, client-rendered tab state
- **Code Review tab** (`CodeReviewPanel.jsx`): the original tool, form → results view, unchanged behavior
- **Automation tab** (`AutomationPanel.jsx`): status/config view for the webhook responder below — env-var status, the webhook URL to register, setup steps, and a recent-activity feed
- **Model tab** (`ModelPanel.jsx`): pick which model `analyzer.js`/`chat.js` spawn opencode with — opencode's own free models always, plus models from any provider connected in the Providers section on the same tab (paid providers show real per-1M-token pricing, never hidden as if free)
- Input form for PR URL and GitHub token
- Displays review results grouped by 6 categories (Performance, Security, Readability, Bugs, Scalability, Best Practices)
- Shows severity badges (critical/high/medium/low) and type badges (Bug/Concern/Strength/Info)
- Actions: **Post to PR** (submits review as GitHub PR review comment), **Describe** (regenerates the PR description from the review), **Label** (applies derived `size/*`/`risk/*` labels), **Merge PR** (merges the PR, shown only on APPROVE), **Chat** (opens `ChatPanel`)
- Every finding has 👍/👎 feedback buttons (`POST /api/feedback`) — see [Review-Time Enrichment](#5-review-time-enrichment-lib-servicesreview-configjs-dependency-scanjs-feedbackjs) below
- Token persisted in `localStorage` under `PRISMLENS_TOKEN`
- Dev: `npm run dev`; Production: `npm run build && npm run start` — both a single process, no build-then-serve-statically step to coordinate

### 2. API (`app/api/`)
- **Next.js Route Handlers**, Node.js runtime (not edge — the review/chat routes shell out to a child process)
- Same 5 POST endpoints + 1 health check as before, same paths, same request/response shapes
- Proxies all GitHub API calls (token stays server-side, passed per-request from the client)
- Imports the same `lib/services/analyzer.js` module the CLI uses
- Runs as a single persistent Node.js process (`next start`), not serverless — `chat.js` can take up to 20 minutes per turn (it shells out to the `opencode` CLI), which needs a long-lived process rather than a serverless function

### 3. CLI (`cmd/`)
- **Node.js terminal tool** using `commander`
- Imports `analyzePR` from `lib/services/analyzer.js` directly (no HTTP call, doesn't need the Next.js server running)
- Options: `--json` (raw JSON), `-o <file>` (markdown report export)

### 4. Automation (`app/api/webhooks/github/`, `app/api/automation/status/`, `lib/services/automation.js`)
- The dashboard's Automation tab (`AutomationPanel.jsx`) reads `GET /api/automation/status` for a live snapshot: whether `GITHUB_TOKEN`/`GITHUB_WEBHOOK_SECRET` are set, the resolved bot login, the webhook URL to register, and the last 20 entries from an in-memory activity log — never the secret values themselves
- GitHub calls `POST /api/webhooks/github` directly once a webhook is registered on a repo — this endpoint is not used by the client
- `lib/webhook-verify.js` checks the `X-Hub-Signature-256` HMAC before anything else runs, and filters events down to `created` PR comments (general or inline)
- The route ACKs `200` immediately, then runs the actual work in Next's `after()` — a full opencode turn can take minutes, far longer than a webhook delivery timeout tolerates
- `lib/services/automation.js` resolves the token owner's identity (`GET /user`), guards against replying to its own comments (the loop-prevention check), confirms the PR is assigned to or authored by that identity, runs the same `fetchPR` → `fetchPRFiles` → `analyzePR` pipeline the interactive UI uses, then feeds the comment through the same `prismlens-chat` agent `lib/services/chat.js` already spawns
- **Propose-only**: the agent's own preview → confirm → commit workflow (see `.opencode/agents/prismlens-chat.md`) means the automated reply is always analysis or a fix preview — it never commits without an explicit human confirmation, and this build doesn't wire up that confirmation step at all
- Uses `GITHUB_TOKEN` server-side (unlike the interactive UI, which never stores a token) — see `docs/api.md` for the env vars and webhook registration steps
- Output grouped by the 6 categories with severity breakdown

### 5. Review-time enrichment (`lib/services/review-config.js`, `dependency-scan.js`, `feedback.js`)

Three independent, optional layers `analyzePR()` composes on top of the core per-file analysis. Each degrades silently if unavailable — none can fail or block a review:

- **`review-config.js`** — fetches `.prismlens.json` from the PR's own branch (via the existing `fetchFileContent`) before analysis runs. `ignorePaths` (glob, `*` within a path segment / `**` across segments) filters which files even reach the analyzer; `severityOverrides` and `disabledChecks` are applied to every finding afterward, AI-generated or fallback-regex alike. No file, or invalid JSON → an empty/default config, not an error.
- **`dependency-scan.js`** — runs only if the diff touches `package.json` and only if a `token` was passed to `analyzePR()`. Fetches the full manifest, merges `dependencies`+`devDependencies` (capped at 40 to bound request volume), and queries [OSV.dev](https://osv.dev) per-package with an 8s timeout. Results become `security`-category `BUG` findings folded in via `mergeFindings()` — a helper that recomputes every categorized array (`reviews`, `strengths`/`concerns`/`bugs`/`info`, per-dimension) rather than duplicating `buildResult()`'s categorization logic inline.
- **`feedback.js`** — `POST /api/feedback` appends a 👍/👎 record to `.prismlens-feedback.json` (gitignored, capped at the 200 most recent entries). `analyzeWithOpenCode()` reads the last 10 👎'd issue texts and passes them to the AI as `avoidPatternsLike` — a calibration signal ("don't re-flag things phrased like this"), not a hard suppression rule; see `.opencode/agents/prismlens-review.md`.

Also folded into every review, no separate service: `analyzer.js`'s `checkMissingTests()` flags a PR that adds 15+ lines of new code across non-test files without touching any test file itself, as a `best-practices` `CONCERN`. Its `recommendation` isn't generic — `test-skeleton.js`'s `testSkeletonFor(filename)` produces a real, extension-keyed test skeleton (JS/TS, Python, Go, Ruby, Java, Rust) for the file with the most additions, embedded directly in the finding so it's visible in the dashboard itself, not only when posted to GitHub.

### Codebase-aware AI review (`analyzeWithOpenCode` in `analyzer.js`)

The AI review path is no longer diff-only. Before invoking opencode, and only when a `token` is available, `analyzeWithOpenCode()` gathers two extra pieces of context, both best-effort (a failure here just means the review proceeds patch-only, never blocks):

- **Full file content** — `fetchFullFileContents()` calls `github.js`'s `fetchFileContent()` for every changed, non-removed file (capped at 25 files, 15,000 chars each) so the model reads the surrounding function/module, not just the `+`/`-` lines of the patch.
- **Repo tree** — `github.js`'s `fetchRepoTree()` lists every blob path in the repository at the PR's head commit (`GET .../git/trees/{sha}?recursive=1`, capped at 300 paths, `truncated` flagged if the repo has more) so the model has a structural map — module boundaries, naming conventions, whether similar code already exists elsewhere — without fetching every file's content.

Both are written into `.prismlens-review-context.json` as `files[].fullContent` and `repoTree`/`repoTreeTruncated`, and `.opencode/agents/prismlens-review.md` instructs the agent to read `fullContent` as its primary material while still anchoring findings to lines the PR actually changed (never flagging pre-existing code it happens to see while reading context). The per-review opencode timeout was raised from 180s to 240s to accommodate the larger context. The regex fallback path is unaffected — it's inherently diff-based (it only ever looks at added lines) and has no model to reason about a wider codebase.

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
Route Handler (app/api/review/route.js)
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
- No CORS middleware — UI and API are same-origin (one Next.js process), so there's no cross-origin caller to allow
- Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) set in `next.config.js`, no CSP (matches the prior Helmet config, which also left CSP disabled)
- No database — all processing is ephemeral
- Token stored in `localStorage` (not cookies) on the client
- The webhook path is the one exception to "token never stored server-side": `GITHUB_TOKEN` in `.env` authorizes `/api/webhooks/github`'s automated replies, since there's no browser session to supply a per-request token. Every delivery is HMAC-verified (`X-Hub-Signature-256` against `GITHUB_WEBHOOK_SECRET`) before anything else runs, and the endpoint 501s outright if either env var is unset
- Provider API keys entered in the Model tab go straight to opencode's own credential store (`~/.local/share/opencode/auth.json`) — the same file `opencode providers login` writes to — never through PrismLens's own storage, `.env`, or logs, and never echoed back in an API response

## Key Design Decisions

1. **Per-file, multi-dimension analysis** — every file is evaluated against all 6 dimensions, not just file-type-specific checks
2. **Same analyzer for CLI and Web** — `lib/services/analyzer.js` imported by both the Next.js API routes and `cmd/`
3. **ES Modules** throughout — `"type": "module"` in package.json
4. **No database** — ephemeral, no PR data stored
5. **Action buttons in UI** — Post to PR and Merge PR available from the results view
6. **Single-origin, single-process** — the UI and API are one Next.js app; no dev proxy or separate static-file server to coordinate
