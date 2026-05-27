# Architecture Overview

## Project Structure

```
prismlens/
├── client/
│   ├── index.html               # Vite entry
│   ├── vite.config.js           # Vite config (proxies /api to server)
│   ├── package.json             # React + Vite deps
│   └── src/
│       ├── main.jsx             # React entry
│       ├── App.jsx              # Main app with cyberpunk UI
│       └── services/
│           └── api.js           # REST API client
├── server/
│   ├── index.js                # Express server entry
│   ├── routes/
│   │   └── review.js           # REST API routes
│   └── services/
│       ├── github.js           # GitHub API integration
│       └── analyzer.js         # Opencode review engine
├── cmd/
│   └── index.js                # CLI tool (imports server services)
├── docs/
│   ├── architecture.md         # This file
│   └── api.md                  # Client-Server API docs
├── package.json
└── .env.example
```

## Three-Tier Architecture

```
┌──────────┐     HTTP/JSON     ┌──────────┐     HTTPS    ┌──────────┐
│          │ ─────────────────> │          │ ────────────> │          │
│  Client  │   POST /api/*      │  Server  │   GitHub API  │  GitHub  │
│ (Browser)│ <───────────────── │ (Node)   │ <──────────── │          │
│          │   JSON Response    │          │   JSON Data   │          │
└──────────┘                   └──────────┘               └──────────┘
```

### 1. Client (`client/public/index.html`)
- **Cyberpunk glassmorphism UI** — single-page HTML app
- Makes `POST /api/review` with `{ prUrl, token }`
- Renders structured review report (strengths, concerns, bugs, recommendation)
- Token is saved in `localStorage` for convenience
- No direct GitHub API calls — all proxied through the server

### 2. Server (`server/`)
- **Express.js app** on port `3000`
- Serves the client's static files (`client/public/`)
- Provides REST API endpoints for review
- Calls GitHub API on the server side (keeps token secure)
- Applies opencode-style analysis

### 3. CLI (`cmd/`)
- **Terminal tool** — imports server services directly
- Uses `commander` for CLI argument parsing
- Supports `--json` for raw output, `--output` for file export
- Can run independently or alongside the web server

## How the Server Calls Opencode

The term "opencode" refers to our custom review analysis engine in `server/services/analyzer.js`. The flow is:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Fetch PR    │     │  Categorize  │     │  Analyze     │
│  from GitHub │ ──> │  Files      │ ──> │  Each Group  │
│  (github.js) │     │  (groupFiles)│     │  (analyze*)  │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
┌─────────────┐     ┌─────────────┐            │
│  Return      │ <── │  Build       │ <─────────┘
│  JSON Report │     │  Report     │
│  to Client   │     │  (analyzePR) │
└─────────────┘     └─────────────┘
```

### Analysis Pipeline Steps

1. **Fetch Phase** (`github.js`)
   - Parse PR URL → `(owner, repo, prNumber)`
   - GET `/repos/{owner}/{repo}/pulls/{number}` → PR metadata
   - GET `/repos/{owner}/{repo}/pulls/{number}/files` → diff data

2. **Categorization Phase** (`analyzer.js → groupFiles()`)
   - Services (`/service.js`)
   - Controllers (`/controller.js`)
   - Mappers (`/mappers/`)
   - Utils (`/utils/`)
   - Builders (`/utils/builders/`)

3. **Analysis Phase** (`analyzer.js → analyze*()`)

   Each group is analyzed independently:

   | Analyzer | Checks For | Pattern |
   |----------|-----------|---------|
   | `analyzeServices` | TODO comments, null safety | `?.`, `|| null`, `// TODO` |
   | `analyzeControllers` | async/await, response messages | `async`, `await`, `message:` |
   | `analyzeMappers` | extract/transform patterns | `extract`, `normalize`, `?.` |
   | `analyzeUtils` | new exports, shared helpers | `export const`, `safeArray` |
   | `analyzeBuilders` | optional chaining, XML templates | `?.`, `<cns:`, `</` |

4. **Report Building Phase** (`analyzer.js → analyzePR()`)
   - Aggregates all findings
   - Categorizes into: `strengths`, `concerns`, `bugs`, `info`
   - Computes recommendation: `APPROVE` / `REVIEW` / `REJECT`
   - Attaches file list with diff stats

## Data Flow Diagram

```
Client (Browser)
     │
     │ POST /api/review { prUrl, token }
     ▼
Server Routes (review.js)
     │
     ├── github.fetchPR(prUrl, token) ────→ GitHub API
     │                                          │
     │    <── PR metadata (title, author, ...)  │
     │                                          │
     ├── github.fetchPRFiles(prUrl, token) ──→ GitHub API
     │                                          │
     │    <── File diffs (patch, stats, ...)    │
     │                                          │
     ▼
Server Analyzer (analyzer.js)
     │
     ├── groupFiles(files) → 5 groups
     ├── analyzeServices(groups.services)
     ├── analyzeControllers(groups.controllers)
     ├── analyzeMappers(groups.mappers)
     ├── analyzeUtils(groups.utils)
     ├── analyzeBuilders(groups.builders)
     │
     ▼
analyzePR(prData, files) → Structured Report
     │
     │ JSON Response
     ▼
Client renders report in cyberpunk UI
```

## Security Model

```
Client          Server                  GitHub
  │               │                       │
  │  POST /api    │                       │
  │  { token }    │                       │
  │ ─────────────>│                       │
  │               │  GET /repos/...       │
  │               │  Authorization: Bearer│
  │               │ ─────────────────────>│
  │               │                       │
  │  <─── JSON ──│  <────── JSON ────────│
```

- **Token never exposed to client**: The server proxies all GitHub API calls
- **CORS disabled for development**: Uses `helmet` + `cors(*)` for flexibility
- **Local token storage**: Client saves token in `localStorage` (not cookies)
- **No database**: All processing is ephemeral — no PR data is stored

## Key Design Decisions

1. **Server-side analysis**: All review logic runs on the server, not in the browser
2. **Same analyzer for CLI and Web**: `analyzer.js` is used by both `server/` and `cmd/`
3. **ES Modules**: Uses `import`/`export` consistently (package.json: `"type": "module"`)
4. **Lightweight**: No database, no build step, no framework on the client
5. **Token in request body**: Simple for the MVP — could be moved to headers for production
