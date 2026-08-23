---
version: 1
slug: "app-code-review-page-jsx"
primary_target: "app/code-review/page.jsx"
related_targets: []
---

# Surface brief — `/code-review` (dashboard)

**Scope & mode:** Operate — the visitor is in a task (running a review, checking automation status, picking a model), not being persuaded. Standard sidebar-nav dashboard shell (`app/code-review/page.jsx`) with three tabs: Code Review (`components/CodeReviewPanel.jsx`, the original tool, unchanged behavior), Automation (`components/AutomationPanel.jsx`), and Model (`components/ModelPanel.jsx`, new).

**Audience & job:** The same engineering-team user as the landing page, now actually using the tool: running a review, checking/configuring the automated PR-comment responder, or choosing which free opencode model powers analysis and chat.

**Structure:** Left sidebar (brand mark linking home, 3 nav buttons, no icons — see below) + content area with a page title and the active panel. Client-side tab state (`useState`), no routing per tab — matches Operate mode's "responsive behavior is structural" guidance without over-engineering URL state for a small dashboard.

**Constraints:** Inherits the established system verbatim — same `.card`/`.btn`/`.section-title` global classes the review panel already used, same neon semantic colors (green=configured/active/success, red=missing/error, blue=info/selected) already established by severity dots and diff coloring elsewhere in the app. New chrome (sidebar, status rows, activity feed, model list) lives in `app/code-review/dashboard.module.css`, imported by the shell, `AutomationPanel`, and `ModelPanel` alike.

**Automation panel specifics:** Pulls `GET /api/automation/status` (booleans for `GITHUB_TOKEN`/`GITHUB_WEBHOOK_SECRET`, resolved bot login, webhook URL, last 20 activity entries from `lib/services/automation.js`'s in-memory log — never the secret values themselves). Shows: status rows with colored dots, a copyable webhook URL, the real GitHub webhook-registration steps, and a recent-activity feed with a teaching empty state rather than "nothing here."

**Model panel specifics:** Pulls `GET /api/model` — the real free-model catalog from `opencode models opencode --verbose` (filtered to cost-0 entries), not a hardcoded list, so it stays accurate if opencode's free lineup changes. A radio-style list (`opencode default` plus each free model, name + id + context size), click to select, `POST /api/model` persists to `.prismlens-config.json` (gitignored) and the choice takes effect on the next `analyzer.js`/`chat.js` opencode spawn (both read it via `getSelectedModel()`). Empty/unavailable state when opencode isn't installed, matching the existing regex-fallback messaging elsewhere in the app.

**Floor note:** First pass used 🔎/⚙️ emoji for the sidebar nav items. Removed — unlike the landing page's dimension icons (already established product vocabulary, reused verbatim from `CATEGORIES`), these were a fresh instance of the craft floor's banned "emoji standing in for an icon system" with nothing to inherit from. Nav is text-only; the Model tab's addition kept this precedent rather than reopening it.

**Unresolved decisions:** None outstanding for this surface. Mobile layout (sidebar collapses to a top row under 720px) verified by CSS logic only, not a live narrow screenshot — same tooling limitation noted on the landing page's brief.
