---
version: 1
slug: "app-code-review-page-jsx"
primary_target: "app/code-review/page.jsx"
related_targets: []
---

# Surface brief — `/code-review` (dashboard)

**Scope & mode:** Operate — the visitor is in a task (running a review, checking automation status, picking a model or connecting a provider), not being persuaded. Standard sidebar-nav dashboard shell (`app/code-review/page.jsx`) with three tabs: Code Review (`components/CodeReviewPanel.jsx`), Automation (`components/AutomationPanel.jsx`), and Model (`components/ModelPanel.jsx`).

**Audience & job:** The same engineering-team user as the landing page, now actually using the tool: running a review, checking/configuring the automated PR-comment responder, or choosing/connecting which model powers analysis and chat.

**Structure:** Left sidebar (brand mark linking home, 3 nav buttons, no icons — see below) + content area with a page title and the active panel. Client-side tab state (`useState`), no routing per tab.

**Constraints:** Inherits the established system verbatim — `.card`/`.btn`/`.section-title`/plain `input` global classes, same neon semantic colors (green=configured/active/success, red=missing/error/disconnect, blue=info/selected) already established elsewhere in the app. New chrome lives in `app/code-review/dashboard.module.css`, shared by the shell, `AutomationPanel`, and `ModelPanel`.

**Automation panel specifics:** unchanged from prior brief revision — `GET /api/automation/status`, status rows, copyable webhook URL, setup steps, recent-activity feed.

**Model panel specifics (now two cards):**
- **MODEL card** — `GET /api/model` returns the merged selectable list: opencode's free models (always) plus every model from a *connected* provider, each carrying real `cost`/`free` so a paid model is never shown as if it were free. Radio-style rows, click to select, `POST /api/model` persists to `.prismlens-config.json`.
- **PROVIDERS card** — `GET /api/providers` lists all ~190 opencode/models.dev providers (slim: name, required env var, docs link, model count, configured flag). Connected ones show as chips with a Disconnect action; a search box (query required — nothing renders unfiltered, given ~190 entries) filters to unconnected matches, each with an inline expand-to-connect form (masked API-key input + Save). Credentials are written straight to opencode's own `~/.local/share/opencode/auth.json` (via `lib/services/providers.js`) — the same file `opencode providers login` uses — never through PrismLens's own config or logs. Disconnecting a provider whose model was the active selection resets the selection to default server-side (`app/api/providers/route.js`'s `DELETE`), so nothing is left pointing at a now-unusable model.
- Live-verified end to end against this machine's real opencode state: pre-existing `lmstudio` credential correctly detected as configured; connecting/disconnecting a real (throwaway-key) `openai` credential correctly added/removed its 47 real-priced models from the picker and left `auth.json` exactly as found afterward.

**PR Info addition (Code Review tab, not this route's own change but landed alongside):** `lib/services/analyzer.js`'s `buildResult()` now includes `meta.state` (Open/Merged/Closed/Draft, color-coded green/red like the existing Added/Deleted cells) and `meta.assignees` (joined logins, "Unassigned" when empty) — two more `.info-card`s in the existing responsive `pr-info` grid, same component, no new pattern.

**Floor note:** Sidebar nav stays text-only (established in the prior revision). No new banned patterns introduced by the Providers UI — search input and connect form reuse the site's plain `input`/`.btn` styling, not a new control vocabulary.

**Unresolved decisions:** None. Mobile layout verified by CSS logic only (same noted tooling limitation as the other briefs).
