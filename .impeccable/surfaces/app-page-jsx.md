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

**Proof/content:** Real product taxonomy only — the 6 analyzer dimensions, the 3 verdict states, the 3 GitHub actions, the actual CLI command shape. No invented stats, testimonials, or logos (none exist yet).

**Constraints:** Must inherit the established cyberpunk-glassmorphism system verbatim (palette, Orbitron/JetBrains Mono pairing, `.card`/`.btn`/`.chat-msg` component language) — this is a surface inside an existing world, not a new one.

**Chosen direction & memorable moment:** Verdict-led hero (surface seed `bb136b2f`, dealt lead, candidate #6 of 7 in the ranked list). The memorable moment is the hero itself: a huge glowing pink "REVIEW REQUIRED" verdict box is the first thing anyone sees, before any marketing copy — the product judging a real PR is the pitch.

**Unresolved decisions:** No DESIGN.md exists yet for the project (documents the inherited system independently of this build) — offered as a follow-up, not required here since this is an ordinary extension of an already-established world. Mobile-viewport visual QA was done through code-level reasoning (clamp/auto-fit-grid/flex-wrap, matching `/code-review`'s own proven breakpoints) rather than a live narrow-viewport screenshot — this session's browser automation could not be coerced below its own floor width.
