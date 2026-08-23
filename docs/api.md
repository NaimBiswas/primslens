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
| `meta` | object | PR metadata (title, author, stats) |
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
