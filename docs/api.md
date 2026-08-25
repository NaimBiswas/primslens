# Client-Server API Documentation

## Overview

The client communicates with the server via REST API. All paths are prefixed with `/api/`.

**Base URL:** `http://localhost:3000/api`

**Content-Type:** `application/json`

## Authentication

GitHub token is passed in the request body. The server uses it to authenticate with the GitHub API.

```json
{
  "prUrl": "https://github.com/user/repo/pull/17",
  "token": "ghp_your_personal_access_token"
}
```

---

## `POST /api/review`

Full PR review analysis — evaluates every changed file across 6 dimensions.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prUrl` | string | Yes | Full GitHub PR URL |
| `token` | string | Yes | GitHub personal access token (repo scope) |

```bash
curl -X POST http://localhost:3000/api/review \
  -H "Content-Type: application/json" \
  -d '{"prUrl": "https://github.com/user/repo/pull/17", "token": "ghp_xxxxxx"}'
```

### Response

```json
{
  "meta": {
    "prTitle": "Feat(order Change): ...",
    "prAuthor": "NaimBiswas",
    "prUrl": "https://github.com/...",
    "prNumber": 17,
    "repo": "user/repo",
    "branch": "feature/order-change",
    "state": "Open",
    "assignees": ["NaimBiswas"],
    "stats": { "additions": 245, "deletions": 53, "filesChanged": 6 }
  },
  "reviews": [
    {
      "type": "CONCERN",
      "severity": "high",
      "category": "performance",
      "issue": "Nested loop detected in file.js",
      "recommendation": "Flatten loops or use a Map/Set for O(1) lookups"
    }
  ],
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
    "reason": "No critical issues found. Ready to merge."
  },
  "files": [
    {
      "name": "src/file.js",
      "status": "modified",
      "additions": 3,
      "deletions": 3,
      "patch": "@@ -6,9 +6,8 @@..."
    }
  ]
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `meta` | object | PR metadata (title, author, state, assignees, stats) |
| `reviews` | array | Flat list of all findings |
| `strengths` | array | Findings with type STRENGTH |
| `concerns` | array | Findings with type CONCERN |
| `bugs` | array | Findings with type BUG |
| `info` | array | Findings with type INFO |
| `performance` | array | Performance-related findings |
| `security` | array | Security-related findings |
| `readability` | array | Readability-related findings |
| `bugs_cat` | array | Bug-related findings |
| `scalability` | array | Scalability-related findings |
| `best_practices` | array | Best-practice-related findings |
| `recommendation.verdict` | string | `APPROVE`, `REVIEW`, or `REJECT` |
| `files` | array | Changed files with diff stats |

### Error Response

```json
{ "error": "PR not found or authentication failed" }
```

| Status | Meaning |
|--------|---------|
| 400 | Missing `prUrl` or `token` |
| 401/403 | Invalid or expired token |
| 404 | PR or repository not found |
| 422 | GitHub API validation failure |
| 500 | Internal server error |

### Notes on findings sources

The `reviews` array (and its per-category breakdowns) can include findings from more than just the AI/regex analysis:

- If the PR touches `package.json`, its dependencies are checked against [OSV.dev](https://osv.dev) and any known vulnerability lands as a `security`-category `BUG` finding with the fixed version to upgrade to (see [Dependency Scanning](../README.md#dependency-scanning)). A scan failure never fails the request — it's silently skipped.
- If a repo the PR belongs to has a `.prismlens.json` at its root, findings respect it: paths matching `ignorePaths` are never analyzed, `severityOverrides` rewrite a category's severity, and `disabledChecks` drops a category entirely (see [Custom Review Config](../README.md#custom-review-config)).
- A `best-practices` `CONCERN` is added when the PR adds a substantial amount of new code (15+ lines across non-test files) without touching any test file itself. Its `recommendation` includes a real, language-aware test skeleton for the file with the most additions, not just generic advice.
- When AI analysis runs, it's no longer diff-only: the model reads the full content of every changed file (not just the patch) plus a repo-wide file-tree overview, so findings can reflect the surrounding code and the codebase's own conventions — not only the lines that changed. See [Codebase-aware AI review](architecture.md#codebase-aware-ai-review-analyzewithopencode-in-analyzerjs) in the architecture doc.

---

## `POST /api/review/preview`

Lightweight PR metadata preview (no analysis).

### Request

Same body as `/api/review`.

### Response

```json
{
  "title": "Feat(order Change): ...",
  "author": "NaimBiswas",
  "number": 17,
  "state": "open",
  "html_url": "https://github.com/...",
  "created_at": "2026-05-19T04:01:01Z",
  "head": { "ref": "feature/order-change", "sha": "abc123" },
  "base": { "ref": "main", "sha": "def456" }
}
```

---

## `POST /api/review/post`

Posts the review results as a GitHub PR review comment. The server formats the results into a professional markdown review and submits it via the GitHub API.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prUrl` | string | Yes | Full GitHub PR URL |
| `token` | string | Yes | GitHub personal access token |
| `review` | object | Yes | Full review object from `/api/review` response |

```bash
curl -X POST http://localhost:3000/api/review/post \
  -H "Content-Type: application/json" \
  -d '{"prUrl": "...", "token": "ghp_xxx", "review": { ... }}'
```

### Response

```json
{
  "id": 123456789,
  "html_url": "https://github.com/user/repo/pull/17#pullrequestreview-123456789",
  "message": "Review posted successfully"
}
```

---

## `POST /api/review/merge`

Merges the pull request via GitHub API.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prUrl` | string | Yes | Full GitHub PR URL |
| `token` | string | Yes | GitHub personal access token (write access) |
| `mergeMethod` | string | No | `merge` (default), `squash`, or `rebase` |

```bash
curl -X POST http://localhost:3000/api/review/merge \
  -H "Content-Type: application/json" \
  -d '{"prUrl": "...", "token": "ghp_xxx", "mergeMethod": "squash"}'
```

### Response

```json
{
  "sha": "abc123def456",
  "merged": true,
  "message": "Pull request successfully merged"
}
```

---

## `POST /api/review/describe`

Replaces the PR's description with a summary generated from the review: what changed (file-by-file, verb per file — Add/Remove/Rename/Update), and a review snapshot (per-category finding counts + verdict).

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prUrl` | string | Yes | Full GitHub PR URL |
| `token` | string | Yes | GitHub personal access token (write access) |
| `review` | object | Yes | Full review object from `/api/review` response |

```bash
curl -X POST http://localhost:3000/api/review/describe \
  -H "Content-Type: application/json" \
  -d '{"prUrl": "...", "token": "ghp_xxx", "review": { ... }}'
```

### Response

```json
{
  "html_url": "https://github.com/user/repo/pull/17",
  "message": "PR description updated"
}
```

This overwrites the existing PR body entirely — there's no merge with prior description content.

---

## `POST /api/review/label`

Derives and applies `size/*` and `risk/*` labels from the review. Size (`size/xs`..`size/xl`) is based on total lines changed; risk (`risk/low`/`risk/medium`/`risk/high`) is based on critical/high bug counts and the verdict. Labels are created on the repo first if they don't already exist (a pre-existing label with the same name is left as-is — `422` from GitHub is swallowed).

### Request

Same body as `/api/review/describe`.

```bash
curl -X POST http://localhost:3000/api/review/label \
  -H "Content-Type: application/json" \
  -d '{"prUrl": "...", "token": "ghp_xxx", "review": { ... }}'
```

### Response

```json
{
  "labels": ["size/m", "risk/low"]
}
```

---

## `POST /api/feedback`

Records a 👍/👎 on a single finding. Feedback is stored locally (`.prismlens-feedback.json`, gitignored) and recent 👎s are fed back into the AI's prompt on future reviews as patterns to avoid re-flagging — see [Feedback Loop](../README.md#feedback-loop).

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prUrl` | string | Yes | The PR the finding came from |
| `issue` | string | Yes | The finding's `issue` text |
| `category` | string | Yes | The finding's category |
| `severity` | string | Yes | The finding's severity |
| `vote` | string | Yes | `"up"` or `"down"` |

```bash
curl -X POST http://localhost:3000/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"prUrl": "...", "issue": "Nested loop detected in file.js", "category": "performance", "severity": "high", "vote": "down"}'
```

### Response

```json
{ "recorded": true }
```

---

## `GET /api/health`

Server health check.

### Response

```json
{
  "status": "ok",
  "timestamp": "2026-05-27T00:30:00.000Z"
}
```

---

## `POST /api/automation/register`

Connects a GitHub account for automation. Anyone can call this with their own token — there's no server-wide credential, so this is what lets someone other than whoever deployed the app use automation on their own repos. Stores the token and a freshly generated webhook secret encrypted at rest (see `AUTOMATION_ENCRYPTION_KEY` below) and returns a unique installation id that both the webhook URL and every later status lookup are keyed on.

### Request

```json
{ "githubToken": "ghp_...", "label": "optional name" }
```

### Response

```json
{ "installationId": "5e8b3c...-uuid", "webhookSecret": "a1b2c3..." }
```

## `DELETE /api/automation/register`

Disconnects an account — deletes its stored token, webhook secret, and activity history.

### Request

```json
{ "installationId": "5e8b3c...-uuid" }
```

---

## `POST /api/webhooks/github/[installationId]`

Receives GitHub webhook deliveries. Not called by the client — GitHub calls this directly once a webhook is registered on a repo (Settings → Webhooks → Add webhook) using the URL returned by `POST /api/automation/register`, subscribed to the **Issue comments**, **Pull request review comments**, **Pull request reviews**, and **Pull requests** events.

`installationId` looks up that one connected account's own token and webhook secret — there's no shared server config to fall back on, so an unknown id is rejected outright. Dispatches by event type:

- `pull_request` (`opened`) — every PR opened on the watched repo gets the full 6-dimension review posted as a PR comment automatically, no assignee/author filter (the webhook itself is already scoped to repos this account chose to watch).
- `issue_comment` / `pull_request_review_comment` / `pull_request_review` (`submitted`, with a body) — only for PRs assigned to or authored by the account's own login: runs the same analysis + chat pipeline the interactive UI uses and replies on the PR, a fix preview if the comment implies a code change, a direct answer otherwise. Conversation history persists per PR, so a later "commit" reply has the earlier preview in context. Never commits without an explicit confirmation reply.

### Request

Sent by GitHub, not something you call directly. Key headers:

| Header | Description |
|--------|-------------|
| `X-GitHub-Event` | `issue_comment`, `pull_request_review_comment`, `pull_request_review`, or `pull_request` — anything else is a no-op |
| `X-Hub-Signature-256` | `sha256=<hmac>` of the raw body, keyed with this installation's own webhook secret |
| `X-GitHub-Delivery` | Unique delivery ID, used to ignore GitHub's occasional redeliveries |

### Response

| Status | Meaning |
|--------|---------|
| 200 | Accepted — acknowledged immediately; the actual analysis (which can take minutes) runs after the response is sent |
| 400 | Malformed JSON body |
| 401 | Missing or invalid `X-Hub-Signature-256` |
| 404 | Unknown `installationId` (never registered, or since disconnected) |
| 501 | `DATABASE_URL`/`AUTOMATION_ENCRYPTION_KEY` not configured on the server |

A `200` with `{ "skipped": "<reason>" }` means the event was received but wasn't relevant (not an `opened`/`created`/`submitted` action, a `pull_request_review` with no body text, or the PR isn't assigned to/authored by the account's own login) — this is normal, not an error.

---

## `GET /api/automation/status?installationId=...`

Status + recent-activity snapshot for one connected account, for the Automation tab in the dashboard (`/code-review`). The webhook secret here is safe to return in any environment — it's specific to this one installation, not a value shared by every user of the app.

### Response

```json
{
  "id": "5e8b3c...-uuid",
  "botLogin": "octocat",
  "webhookSecret": "a1b2c3...",
  "recentActivity": [
    { "at": "2026-08-24T10:00:00.000Z", "prUrl": "https://github.com/o/r/pull/1", "outcome": "replied", "prTitle": "Fix rate limiter" }
  ],
  "pendingApprovals": [
    { "prUrl": "https://github.com/o/r/pull/2", "prTitle": "Add rate limiter", "preview": "Here's the proposed fix:\n```diff\n...\n```", "createdAt": "2026-08-26T09:00:00.000Z" }
  ],
  "webhookUrl": "https://your-host/api/webhooks/github/5e8b3c...-uuid"
}
```

`recentActivity[].outcome` is one of `received` (shown as "queued" in the dashboard — the event just landed and is still being processed in the background), `replied`, `skipped` (with a `reason`), or `error` (with a `reason`). Every webhook delivery gets a `received`/`skipped` row the instant it arrives — even ones the account doesn't act on (wrong action, no body text, an unhandled event type) — so a delivery that GitHub shows as `200` always has a matching row here. That row is keyed by GitHub's own delivery id (`X-GitHub-Delivery`): once background processing finishes, the `received` row is updated in place to `replied`/`skipped`/`error` rather than a second row being appended for the same event. `pendingApprovals` lists PRs where a fix was proposed and is waiting for confirmation — one entry per PR, superseded by a newer proposal on the same PR.

## `POST /api/automation/approve`

Approves a pending fix by posting a `commit` comment on the PR using the account's own token — the same trigger a human typing "commit" on GitHub would produce, so it goes through the normal webhook pipeline (with the earlier preview's conversation history intact) rather than committing directly. The actual commit happens once GitHub delivers that comment's webhook, not synchronously with this request.

### Request

```json
{ "installationId": "5e8b3c...-uuid", "prUrl": "https://github.com/o/r/pull/2" }
```

## `POST /api/automation/dismiss`

Clears a pending approval from the dashboard without approving it — doesn't touch the PR itself.

### Request

```json
{ "installationId": "5e8b3c...-uuid", "prUrl": "https://github.com/o/r/pull/2" }
```

---

## `GET /api/ai/models`

The static registry of AI providers PrismLens can call directly (Gemini, OpenAI, Anthropic, Groq, OpenRouter, Mistral, DeepSeek) — id, name, key placeholder, docs link. No credentials, just enough for the Model tab to render a key-input row per provider.

## `POST /api/ai/models`

Validates a user-supplied API key by asking that provider itself which models it exposes.

### Request

```json
{ "providerId": "gemini", "apiKey": "AIza..." }
```

### Response

```json
{ "models": [{ "id": "gemini-3.6-flash", "name": "Gemini 3.6 Flash", "meta": "1.0M context", "free": false }] }
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_TOKEN` | For the CLI only | — | Used by `cmd/index.js`. The web UI takes a token per request instead, and Automation takes its own token per connected account (see below) — neither reads this var. |
| `DATABASE_URL` | For Automation | — | Postgres connection string storing each connected account's encrypted token/webhook secret. Vercel's native Postgres (Neon) integration sets this automatically once attached in the dashboard. |
| `AUTOMATION_ENCRYPTION_KEY` | For Automation | — | Any string; hashed into the AES-256-GCM key used to encrypt stored tokens/secrets at rest. Generate with `openssl rand -base64 32`. Changing it after accounts connect invalidates their stored credentials. |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` / `MISTRAL_API_KEY` / `DEEPSEEK_API_KEY` | No | — | Server-wide AI review/chat backend — set any one to enable it without visitors needing to connect their own key in the Model tab. Each has an optional matching `*_MODEL` var. |
| `PORT` | No | 3000 | Server port |

---

## Testing with curl

```bash
# Health check
curl http://localhost:3000/api/health

# Full review
curl -X POST http://localhost:3000/api/review \
  -H "Content-Type: application/json" \
  -d '{"prUrl": "https://github.com/user/repo/pull/17", "token": "ghp_xxxx"}'

# Preview only
curl -X POST http://localhost:3000/api/review/preview \
  -H "Content-Type: application/json" \
  -d '{"prUrl": "https://github.com/user/repo/pull/17", "token": "ghp_xxxx"}'
```

## Testing with CLI

```bash
# Full review
npm run review https://github.com/user/repo/pull/17 -- --token ghp_xxxx

# Raw JSON output
npm run review https://github.com/user/repo/pull/17 -- --token ghp_xxxx --json

# Save markdown report to file
npm run review https://github.com/user/repo/pull/17 -- --token ghp_xxxx -o report.md
```
