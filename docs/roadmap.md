# Competitor Feature Analysis & Roadmap

This documents the outcome of a competitive pass against other AI PR-review tools (CodeRabbit, Greptile, Korbit, Qodo/CodiumAI, GitHub Copilot code review, and similar) — what they offer that PrismLens didn't, which of those gaps were closed, and which were deliberately left out along with why.

## Shipped this round

All of the following were implemented as direct answers to gaps found in that analysis. Each is documented in full in [`README.md`](../README.md) and [`docs/api.md`](api.md); this is just the origin story.

| Feature | Competitor precedent | PrismLens's take |
|---|---|---|
| Inline one-click-apply suggestions across all categories | CodeRabbit, GitHub Copilot | Already existed for performance; extended to security, bugs, scalability, best-practices |
| Auto-generated PR description | CodeRabbit's "Walkthrough" | `POST /api/review/describe` — file-by-file summary + review snapshot |
| Auto-applied size/risk labels | CodeRabbit, Graphite | `POST /api/review/label` — `size/*` + `risk/*`, derived from diff size and verdict |
| Missing-test detection | Qodo/CodiumAI | Folded into Best Practices rather than a 7th dimension |
| Dependency vulnerability scanning | Greptile, Snyk-integrated tools | [OSV.dev](https://osv.dev) lookup on `package.json`, no API key, no vendor lock-in |
| Learns from reviewer feedback | CodeRabbit's chat-based learnings | 👍/👎 per finding, recent 👎s passed back into the AI prompt as "avoid patterns like this" |
| Per-repo review configuration | CodeRabbit's `.coderabbit.yaml` | `.prismlens.json` — ignore paths, severity overrides, disabled checks |
| Documentation generation | Qodo's `/docstring` | Same preview → confirm → commit flow the chat already used for fixes |

## Deliberately not built (Tier 3)

These are real features competitors have. Each was left out for a stated reason tied to PrismLens's own architecture or product stance — not overlooked.

### Multi-provider git support (GitLab, Bitbucket, Azure DevOps)
Every competitor surveyed supports GitHub at minimum, several support all four. PrismLens is GitHub-only: `lib/services/github.js` is written directly against the GitHub REST API (URLs, auth headers, webhook payload shapes), and the automation path's webhook verification is GitHub's own HMAC scheme specifically. Supporting a second provider isn't a config flag, it's a second full API client, a second webhook contract, and a second auth model — a real project, not an incremental add. **Why deferred**: no signal yet that PrismLens's actual users need anything but GitHub; building it speculatively would be maintaining a second integration nobody exercises.

### IDE extension (VS Code / JetBrains)
CodeRabbit and Qodo both ship editor extensions for pre-commit review. PrismLens's review is PR-diff-shaped by design — it evaluates a GitHub PR's file patches, PR metadata, and comment threads, none of which exist before a PR is opened. An IDE extension would need a genuinely different input model (uncommitted working-tree diffs, no PR object, no GitHub API round-trip) and a different UI shell entirely (a VS Code webview, not a Next.js page). **Why deferred**: it's a different product surface, not an extension of this one — worth considering only if PR-time review turns out to be too late in the workflow for how this tool's users actually work.

### Team/org analytics dashboard
Competitors with a hosted SaaS tier (CodeRabbit, Korbit) show trend charts: findings over time, most-flagged files, reviewer response rates. This directly conflicts with PrismLens's core architectural bet, stated in [`docs/architecture.md`](architecture.md#security-model): **no database, ephemeral processing**. Every review is stateless except the two small local JSON files (`.prismlens-feedback.json`, `.prismlens-config.json`) that intentionally hold no PR content, no history, no cross-repo data. A trends dashboard needs exactly the persistent, queryable store that design explicitly avoids. **Why deferred**: it's not a missing feature, it's the tradeoff on the other side of "self-hosted, single-process, no database" — adding it would mean reversing that decision, not extending it.

### Code graph / dependency visualization
Greptile builds a codebase-wide symbol graph to reason about cross-file blast radius ("this function is called from 12 places"). PrismLens's analysis is intentionally scoped to the PR's own diff — each file's added lines, evaluated independently. A code graph needs indexing the *entire* target repository (clone, parse, build a symbol index) before a single review can run, which changes the latency and infrastructure story from "seconds, no clone" to "minutes, needs a workspace." **Why deferred**: real value (catching a change that breaks a distant caller), but a different cost/latency class than everything else PrismLens does today; worth revisiting if per-file review turns out to miss too much cross-file breakage in practice.

### True multi-agent specialized-review architecture
Some competitors route security findings to a security-tuned sub-agent, performance findings to a separate one, etc. PrismLens's single `prismlens-review` agent already checks all 6 dimensions in one pass over the same diff context — see [`.opencode/agents/prismlens-review.md`](../.opencode/agents/prismlens-review.md). Splitting that into N specialized agents means N times the opencode invocations (cost and latency) per review, for findings that, in practice, already come back well-categorized from a single pass. **Why deferred**: no evidence the single-pass agent's finding quality is the bottleneck; multiplying invocations without a demonstrated accuracy gap is a cost increase with no proven upside.

## Revisit triggers

Worth reopening any of the above if:
- a real user asks for a non-GitHub git host,
- PR-time review is reported as consistently "too late" for how someone works,
- the no-database constraint itself gets revisited for an unrelated reason (at which point analytics becomes cheap to add),
- a single-pass review is shown to actually miss cross-file issues a graph-based approach would catch,
- or the single review agent is shown to underperform a specialized split on a concrete finding-quality metric, not just intuition.
