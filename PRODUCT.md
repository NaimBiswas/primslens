# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Engineering teams evaluating or using PrismLens as part of their PR review process — typically a team lead or eng manager introducing it, with individual developers running it against their own pull requests before or during review.

## Product Purpose
PrismLens automates pull request code review. It analyzes every changed file across 6 dimensions (performance, security, readability, bugs, scalability, best practices), produces severity-graded findings and a clear merge verdict (APPROVE / REVIEW / REJECT), and lets the team act on it directly — chat to discuss or fix findings, then comment, approve, or merge the PR — without leaving the tool.

## Positioning
Most review tools stop at "here are the findings." PrismLens continues into "let's fix them" and "let's ship it": one screen combines multi-dimension analysis, an interactive AI chat over the findings, and direct GitHub actions (comment/approve/merge).

## Operating Context
- Used against real GitHub PRs: paste a PR URL + GitHub token in the web UI, or run `npm run review <pr-url>` from the CLI for terminal/CI-style use.
- AI-mode analysis and chat shell out to the `opencode` CLI; when it isn't available, analysis falls back to a deterministic regex-based analyzer (same output shape, tagged `analysisMode: fallback`).
- Self-hosted by design, not serverless — chat replies can take up to ~20 minutes per turn (the AI works through the findings/codebase via `opencode`), which needs a persistent process, not a request-scoped function.

## Capabilities and Constraints
- 6 review dimensions: performance, security, readability, bugs, scalability, best practices.
- Severity levels: critical, high, medium, low.
- Verdicts: APPROVE, REVIEW, REJECT — merge is only offered on APPROVE.
- Actions from the results screen: post review comment, approve, merge, or open chat.
- Chat runs list/fix-style commands against the findings, backed by `opencode`.
- Token is stored client-side (localStorage) only; nothing is persisted server-side beyond the life of a request. No database — processing is fully ephemeral.
- Web UI and CLI call the exact same analyzer module — no divergent behavior between surfaces.

## Brand Commitments
- Name: PrismLens. Not to be renamed or genericized.
- Existing brand mark: a magnifying lens over a two-line diff (red removed / green added line), rim in a blue→purple→pink gradient — established and binding, not to be replaced.
- Visual identity already established and binding: cyberpunk glassmorphism — near-black ground, neon accent palette (pink `#ff2a6d`, blue `#05d9e8`, purple `#b137fc`, green `#00ffa3`, red `#ff4d4d`), Orbitron for display type, JetBrains Mono for body/data/code.

## Evidence on Hand
- Real taxonomy from the analyzer: the 6 dimensions, 4 severities, and 4 verdict states above are the actual categories the product produces — safe to reference concretely, not to be expanded with invented categories.
- No testimonials, customer names, case studies, or press exist. Do not fabricate any for the landing page.

## Product Principles
1. Every changed file gets full multi-dimension coverage, not a shallow single-pass lint.
2. Findings lead to action — chat and one-click GitHub actions close the loop, not just a report.
3. One analysis engine everywhere (web UI and CLI) — no divergent behavior between surfaces.
4. No data leaves the request — ephemeral processing, token stays client-side, no database.
5. Self-hosted by design — AI-backed review and chat aren't shaped for serverless.
