---
version: 1
slug: "app-code-review-page-jsx"
primary_target: "app/code-review/page.jsx"
related_targets: []
---

# Surface brief — `/code-review` (dashboard)

**Scope & mode:** Operate — the visitor is in a task (running a review, checking automation status), not being persuaded. Standard sidebar-nav dashboard shell (`app/code-review/page.jsx`) with two tabs: Code Review (`components/CodeReviewPanel.jsx`, the original tool, unchanged behavior) and Automation (`components/AutomationPanel.jsx`, new).

**Audience & job:** The same engineering-team user as the landing page, now actually using the tool: running a review, or checking/configuring the automated PR-comment responder.

**Structure:** Left sidebar (brand mark linking home, 2 nav buttons, no icons — see below) + content area with a page title and the active panel. Client-side tab state (`useState`), no routing per tab — matches Operate mode's "responsive behavior is structural" guidance without over-engineering URL state for a 2-tab dashboard.

**Constraints:** Inherits the established system verbatim — same `.card`/`.btn`/`.section-title` global classes the review panel already used, same neon semantic colors (green=configured/success, red=missing/error, blue=info) already established by severity dots and diff coloring elsewhere in the app. New chrome (sidebar, status rows, activity feed) lives in `app/code-review/dashboard.module.css`, imported by both the shell and `AutomationPanel`.

**Automation panel specifics:** Pulls `GET /api/automation/status` (booleans for `GITHUB_TOKEN`/`GITHUB_WEBHOOK_SECRET`, resolved bot login, webhook URL, last 20 activity entries from `lib/services/automation.js`'s in-memory log — never the secret values themselves). Shows: status rows with colored dots, a copyable webhook URL, the real GitHub webhook-registration steps, and a recent-activity feed with a teaching empty state rather than "nothing here."

**Floor note:** First pass used 🔎/⚙️ emoji for the two sidebar nav items. Removed — unlike the landing page's dimension icons (already established product vocabulary, reused verbatim from `CATEGORIES`), these were a fresh instance of the craft floor's banned "emoji standing in for an icon system" with nothing to inherit from. Nav is text-only.

**Unresolved decisions:** None outstanding for this surface. Mobile layout (sidebar collapses to a top row under 720px) verified by CSS logic only, not a live narrow screenshot — same tooling limitation noted on the landing page's brief.
