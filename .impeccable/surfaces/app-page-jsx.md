---
version: 1
slug: "app-page-jsx"
primary_target: "app/page.jsx"
related_targets: []
---

# Surface brief — `/` (landing page)

**Scope & mode:** Marketing entry point for the whole app. Persuade mode — a first-time visitor decides whether to click through to `/code-review`.

**Audience & job:** An engineering team lead or eng manager evaluating PrismLens as a PR review tool, in the ten seconds before they either click through or bounce.

**Action:** Click "Start a Review" → `/code-review`. Everything on the page serves that one action.

**Proof/content:** Real product taxonomy only — the 6 analyzer dimensions, the 4-step fetch→scan→verdict flow, the 3 verdict states with their actual trigger logic (from `analyzer.js`'s `buildRecommendation`), the AI-vs-regex-fallback distinction, the 3 GitHub actions, the actual CLI command shape. No invented stats, testimonials, or logos (none exist yet).

**Constraints:** Must inherit the established cyberpunk-glassmorphism system verbatim (palette, Orbitron/JetBrains Mono pairing, `.card`/`.btn`/`.chat-msg`/`.recommendation-box`/`.mode-badge` component language) — this is a surface inside an existing world, not a new one.

**Chosen direction & memorable moment:** Verdict-led hero (surface seed `bb136b2f`, dealt lead, candidate #6 of 7 in the ranked list). The memorable moment is the hero itself: a huge glowing pink "REVIEW REQUIRED" verdict box is the first thing anyone sees, before any marketing copy — the product judging a real PR is the pitch. The verdict-logic section later reuses the exact same `.recommendation-box` component in its 3 real states (reject/review/approve), paying off the hero's promise with the actual mechanism rather than restating it in prose.

**Structural variety (pacing):** hero (single glowing box) → step flow (connected, arrow-linked, not cards) → dimension grid (6 equal cards — genuine taxonomy) → verdict grid (3 cards, reusing the real component) → chat transcript (unique) → action row (buttons, not cards) → AI/fallback comparison (single divided panel, not a card grid) → CLI strip → final CTA. Deliberately alternates card-grid, flow, and panel structures rather than repeating one shape section after section.

**Unresolved decisions:** No DESIGN.md exists yet for the project (documents the inherited system independently of this build) — offered as a follow-up, not required here since this is an ordinary extension of an already-established world. Mobile-viewport visual QA was done through code-level reasoning (clamp/auto-fit-grid/flex-wrap, matching `/code-review`'s own proven breakpoints) rather than a live narrow-viewport screenshot — this session's browser automation could not be coerced below its own floor width.
