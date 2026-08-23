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
- A `best-practices` `CONCERN` is added when the PR adds a substantial amount of new code (15+ lines across non-test files) without touching any test file itself.

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

## `POST /api/webhooks/github`

Receives GitHub webhook deliveries for automated PR-comment responses. Not called by the client — GitHub calls this directly once a webhook is registered on a repo (Settings → Webhooks → Add webhook), subscribed to the **Issue comments** and **Pull request review comments** events.

Requires `GITHUB_TOKEN` and `GITHUB_WEBHOOK_SECRET` to be set server-side (see below); otherwise every delivery is rejected with `501` before any processing.

For a `created` comment on a PR assigned to or authored by the `GITHUB_TOKEN` owner, PrismLens runs the same analysis + chat pipeline the interactive UI uses and replies on the PR — a fix preview if the comment implies a code change, a direct answer otherwise. It never commits on its own.

### Request

Sent by GitHub, not something you call directly. Key headers:

| Header | Description |
|--------|-------------|
| `X-GitHub-Event` | `issue_comment` or `pull_request_review_comment` — anything else is a no-op |
| `X-Hub-Signature-256` | `sha256=<hmac>` of the raw body, keyed with `GITHUB_WEBHOOK_SECRET` |
| `X-GitHub-Delivery` | Unique delivery ID, used to ignore GitHub's occasional redeliveries |

### Response

| Status | Meaning |
|--------|---------|
| 200 | Accepted — acknowledged immediately; the actual analysis (which can take minutes) runs after the response is sent |
| 400 | Malformed JSON body |
| 401 | Missing or invalid `X-Hub-Signature-256` |
| 501 | `GITHUB_TOKEN` or `GITHUB_WEBHOOK_SECRET` not configured |

A `200` with `{ "skipped": "<reason>" }` means the event was received but wasn't relevant (not a PR comment, not a `created` action, or the PR isn't assigned to/authored by the token owner) — this is normal, not an error.

---

## `GET /api/automation/status`

Configuration + recent-activity snapshot for the Automation tab in the dashboard (`/code-review`). Never returns the token or webhook secret values — booleans only, plus the public GitHub login they resolve to.

### Response

```json
{
  "tokenConfigured": true,
  "webhookSecretConfigured": false,
  "botLogin": "octocat",
  "recentActivity": [
    { "at": "2026-08-24T10:00:00.000Z", "prUrl": "https://github.com/o/r/pull/1", "eventType": "issue_comment", "outcome": "replied", "prTitle": "Fix rate limiter" }
  ],
  "webhookUrl": "https://your-host/api/webhooks/github"
}
```

`recentActivity[].outcome` is one of `replied`, `skipped` (with a `reason`), or `error` (with a `reason`).

---

## `GET /api/model`

Lists opencode's free models (the `opencode` provider, cost 0 — no API key needed) and the currently selected one, for the Model tab in the dashboard.

### Response

```json
{
  "models": [
    { "id": "opencode/hy3-free", "name": "Hy3 Free", "context": 190000 }
  ],
  "selected": "opencode/hy3-free",
  "opencodeAvailable": true
}
```

`selected: null` means no override is set — review and chat runs use whatever opencode itself is configured to default to. `opencodeAvailable: false` means the `opencode` CLI isn't installed at all (same condition the regex-fallback analyzer falls back for).

## `POST /api/model`

Sets the model used for future `/api/review` and `/api/chat` runs (and the webhook automation, which shares the same analyzer/chat code). Persisted to `.prismlens-config.json` at the project root, so it survives a restart.

### Request

```json
{ "model": "opencode/hy3-free" }
```

Pass `{ "model": null }` to clear the override and go back to opencode's own default. Any other value must match an `id` from `GET /api/model`'s list — `400` otherwise.

`GET /api/model`'s list now includes models from every provider connected via `/api/providers` below, not just opencode's free ones — each entry carries `cost` and `free` so paid models are never presented as if they were free.

---

## `GET /api/providers`

Every provider opencode/models.dev knows about (~190) — name, required env var(s), docs link, model count, and whether a credential is already configured. Slim payload, no per-model detail.

### Response

```json
{
  "providers": [
    { "id": "openai", "name": "OpenAI", "envVars": ["OPENAI_API_KEY"], "doc": "https://platform.openai.com/docs/models", "modelCount": 47, "configured": false }
  ]
}
```

## `POST /api/providers`

Saves an API key for a provider — to opencode's own credential store (`~/.local/share/opencode/auth.json`), the same file `opencode providers login` writes to. Never echoed back in any response.

### Request

```json
{ "providerId": "openai", "apiKey": "sk-..." }
```

## `DELETE /api/providers`

Removes a provider's credential. If the currently selected model (`GET /api/model`) belonged to that provider, the selection is reset to opencode's default too, so nothing is left pointing at a now-unusable model.

### Request

```json
{ "providerId": "openai" }
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_TOKEN` | For CLI and automation | — | Used by the CLI, and by `/api/webhooks/github` to act on your behalf. The web UI is unaffected — it still takes a token per request. |
| `GITHUB_WEBHOOK_SECRET` | For automation only | — | Shared secret configured when registering the webhook on GitHub; verifies deliveries actually came from GitHub. |
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
