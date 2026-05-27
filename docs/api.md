# Client-Server API Documentation

## Overview

The client (browser UI) communicates with the server via REST API endpoints. All API paths are prefixed with `/api/`.

**Base URL:** `http://localhost:3000/api`

**Content-Type:** `application/json`

## Authentication

The GitHub token is passed in the request body (not headers). The server uses it to authenticate with the GitHub API.

```json
{
  "prUrl": "https://github.com/user/repo/pull/17",
  "token": "ghp_your_personal_access_token"
}
```

## Endpoints

---

### `POST /api/review`

Full PR review analysis. This is the primary endpoint used by the client.

#### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prUrl` | string | ✅ | Full GitHub PR URL |
| `token` | string | ✅ | GitHub personal access token (repo scope) |

**Example:**
```bash
curl -X POST http://localhost:3000/api/review \
  -H "Content-Type: application/json" \
  -d '{
    "prUrl": "https://github.com/Laststop-live/Bintech.ndc/pull/17",
    "token": "ghp_xxxxxx"
  }'
```

#### Response

```json
{
  "meta": {
    "prTitle": "Feat(order Change): Updated OrderChange response for none case",
    "prAuthor": "NaimBiswas",
    "prUrl": "https://github.com/Laststop-live/Bintech.ndc/pull/17",
    "prNumber": 17,
    "repo": "Laststop-live/Bintech.ndc",
    "branch": "feature/order-change",
    "stats": {
      "additions": 245,
      "deletions": 53,
      "filesChanged": 6
    }
  },
  "reviews": [
    {
      "type": "STRENGTH",
      "severity": "high",
      "category": "Code Architecture",
      "issue": "Data extraction/transform patterns in mappers",
      "recommendation": "Keep separation of concerns..."
    }
  ],
  "strengths": [],
  "concerns": [],
  "bugs": [],
  "info": [],
  "recommendation": {
    "verdict": "APPROVE",
    "label": "✅ Approve",
    "reason": "No issues found. Ready to merge."
  },
  "files": [
    {
      "name": "src/app/modules/booking/booking.service.js",
      "status": "modified",
      "additions": 3,
      "deletions": 3,
      "patch": "@@ -6,9 +6,8 @@..."
    }
  ]
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `meta` | object | PR metadata (title, author, stats) |
| `meta.stats` | object | `additions`, `deletions`, `filesChanged` |
| `reviews` | array | All findings (flat list) |
| `strengths` | array | ✅ Positive findings |
| `concerns` | array | ⚠️ Issues needing attention |
| `bugs` | array | 🐛 Potential runtime errors |
| `info` | array | ℹ️ Neutral observations |
| `recommendation` | object | Verdict with label and reason |
| `recommendation.verdict` | string | `APPROVE` / `REVIEW` / `REJECT` |
| `files` | array | List of changed files with diff stats |

#### Error Response

```json
{
  "error": "PR not found or authentication failed"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Missing `prUrl` or `token` |
| 401/403 | Invalid or expired GitHub token |
| 404 | PR or repository not found |
| 500 | Internal server error |

---

### `POST /api/review/preview`

Lightweight PR metadata preview (no full analysis). Useful for showing PR info before committing to a full review.

#### Request

Same body as `/api/review`:
```json
{
  "prUrl": "https://github.com/user/repo/pull/17",
  "token": "ghp_xxxxxx"
}
```

#### Response

```json
{
  "title": "Feat(order Change): Updated OrderChange response for none case",
  "author": "NaimBiswas",
  "number": 17,
  "state": "open",
  "html_url": "https://github.com/Laststop-live/Bintech.ndc/pull/17",
  "created_at": "2026-05-19T04:01:01Z",
  "head": { "ref": "feature/order-change", "sha": "abc123" },
  "base": { "ref": "main", "sha": "def456" }
}
```

---

### `GET /api/health`

Server health check.

#### Response

```json
{
  "status": "ok",
  "timestamp": "2026-05-27T00:30:00.000Z"
}
```

## Client-Server Communication Sequence

```
Client (Browser)              Server (Node)              GitHub API
     │                            │                        │
     │─── POST /api/review ──────>│                        │
     │    { prUrl, token }        │                        │
     │                            │─── GET /repos/... ────>│
     │                            │    Authorization: Bear │
     │                            │<─── PR + Files JSON ──│
     │                            │                        │
     │                            │ analyzePR(prData, files)
     │                            │                        │
     │<── JSON Review Report ─────│                        │
     │                            │                        │
     │       Render UI            │                        │
```

## How the Client Calls Opencode Analysis

The client (browser) does NOT call opencode directly. Instead:

1. **Client sends request** → `POST /api/review` with `{ prUrl, token }`
2. **Server processes** → Fetches from GitHub, runs analyzer
3. **Server returns** → Structured JSON report
4. **Client renders** → Builds DOM elements from response data

The client JS maps server response to UI sections:

```javascript
// Client-side rendering logic (simplified)
const res = await fetch('/api/review', { method: 'POST', body: JSON.stringify({ prUrl, token }) });
const data = await res.json();

// Render strengths
data.strengths.forEach(s => renderCard('strength', s));

// Render concerns  
data.concerns.forEach(c => renderCard('concern', c));

// Render bugs
data.bugs.forEach(b => renderCard('bug', b));

// Show recommendation
showRecommendation(data.recommendation);

// List files
data.files.forEach(f => renderFileRow(f));
```

## Error Handling

### Client-Side

```javascript
try {
  const res = await fetch('/api/review', { method: 'POST', body: ... });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  // Process data...
} catch (err) {
  // Show error to user, reset form
}
```

### Server-Side

```javascript
// review.js route handler
try {
  const [prData, files] = await Promise.all([fetchPR(...), fetchPRFiles(...)]);
  const review = analyzePR(prData, files);
  res.json(review);
} catch (err) {
  const status = err.response?.status || 500;
  res.status(status).json({ error: err.response?.data?.message || err.message });
}
```

## Rate Limiting

Both the server's GitHub API calls and the client's requests are subject to rate limits:

- **GitHub API**: 5000 requests/hour with authenticated token
- **Server**: No built-in rate limiter (add `express-rate-limit` for production)
- **Client**: Browser fetch has no rate limiting (depends on server)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | No (pass in body) | Default token for server-side use |
| `PORT` | No | Server port (default: 3000) |

## Testing the API

### Using curl

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

### Using the CLI

```bash
# Full review (terminal output)
npm run review https://github.com/user/repo/pull/17 -- --token ghp_xxxx

# JSON output
npm run review https://github.com/user/repo/pull/17 -- --token ghp_xxxx --json

# Save to file
npm run review https://github.com/user/repo/pull/17 -- --token ghp_xxxx -o report.md
```
