import { getProvider } from './ai-providers.js';

// Matches chat's own budget for the same kind of call — PRODUCT.md documents
// this as an explicit constraint, not an oversight. Real enforcement is the
// platform's function timeout (see maxDuration on the review/chat routes);
// this is just a safety net so a hung connection doesn't dangle forever.
export const AI_REVIEW_TIMEOUT_MS = 1200000;

export function buildReviewPrompt(context) {
  return `You are the PrismLens Code Review Analyzer. Analyze the pull request context below and return structured findings.

Only files with a non-empty "patch" have changes to review. Use "fullContent" as your primary reading material, not "patch" — it's the surrounding function/file, so you understand what the change does in context, not just which lines have a +/-. Still anchor findings to lines the patch actually changed; don't flag pre-existing code the PR didn't touch. When "fullContent" is null, reason from "patch" alone.

"repoTree" is every file path in the repo (structure only, no content) — use it to judge whether a change duplicates existing logic or violates the project's own layout conventions. Don't invent claims about files you can't see the content of.

If "avoidPatternsLike" is non-empty, those are past findings reviewers marked unhelpful — don't repeat findings in that same spirit.

## Categories to check (check all, for every file; report only real issues in the added code)
- performance: nested loops (O(n²)+), spread inside loops, console.log/dir/table/warn/error, excessive spread usage, large JSON.parse/stringify on data/response/result vars, repeated DOM queries in loops, unnecessary array copies (.map().filter() chains)
- security: innerHTML/dangerouslySetInnerHTML assignments, eval()/new Function()/document.write(), exec()/spawn()/child_process, hardcoded credentials (ghp_, sk-, AKIA..., passwords/secrets), user input interpolated into strings without sanitization, template literals in SQL queries, missing input validation
- readability: lines over 120 chars, 4+ levels of nesting, magic numbers (bare numeric literals >= 4 digits), single-letter variable names outside loop counters, 4+ ternaries in a file, 50+ line change blocks, functions doing too many things
- bugs: loose equality (==), chained property access without ?., .then() without .catch(), NaN comparison (use Number.isNaN()), function parameter reassignment, off-by-one errors, missing null/undefined checks, async without error handling
- scalability: async inside forEach, synchronous I/O in server code, array operations on large datasets without pagination, missing event listener cleanup, hardcoded limits/timeouts
- best-practices: TODO/FIXME/HACK comments, deprecated APIs (require(), componentWillMount, findDOMNode, ReactDOM.render, manual env checks), async functions without try-catch, missing input validation, direct React state mutation, .map() in JSX without key, hardcoded config that should be an env var

## Output
Print exactly one complete, self-contained JSON object per finding, on its own line. No markdown, no code fences, no explanation, no wrapping array or {"findings": [...]} envelope:
{"type": "BUG|CONCERN|INFO|STRENGTH", "severity": "critical|high|medium|low", "category": "performance|security|readability|bugs|scalability|best-practices", "file": "exact filename from the input", "issue": "Clear specific description referencing the actual code pattern. Include the filename.", "recommendation": "Actionable suggestion to fix the issue"}

"file" is required on every finding — copy it verbatim from the "filename" field of the file object you're reviewing. If a file's patch is empty or has no added lines, skip it. If everything is clean, print nothing at all. For STRENGTH findings, note genuinely good patterns (proper error handling, security practices, clean code).

Write "issue" and "recommendation" the way an experienced engineer actually talks in a PR comment — direct, specific, no filler. Say what's wrong and why it matters in one breath, the way a person would, not "X detected in Y — potential Z" boilerplate. Skip the finding entirely if you wouldn't actually bother leaving that comment on a real PR.

## Input
${JSON.stringify(context)}`;
}

/**
 * Used instead of buildReviewPrompt whenever a ticket description is
 * supplied — the review is scoped entirely to "does this PR satisfy the
 * ticket", not general code-quality/style checks. Still emits the same
 * finding contract (type/severity/category/file/issue/recommendation) so
 * the rest of the pipeline (verdict, post-to-PR, labels, feedback) needs no
 * ticket-specific handling.
 */
export function buildTicketReviewPrompt(context) {
  return `You are an experienced engineer reviewing a pull request against its ticket, the way you actually would before approving it: read the ticket, read the diff, and say plainly what's done, what's missing, and what's off — not a general code-quality review. Ignore code style, formatting, and generic best-practice nitpicks that have nothing to do with whether the ticket's requirements were met.

## Ticket description
${context.ticketDescription}

## Your job
Read the ticket, then the PR's changed files below, and work out — requirement by requirement — whether the implementation actually does what was asked.

- Fully and correctly done → a STRENGTH finding. Say what it does and where, like you'd casually confirm it in a comment — not "Requirement X: implemented."
- Missing entirely → a BUG finding ("critical" if it's a core part of the ticket, "high" otherwise). Say what's missing and where you'd expect to find it, the way you'd point it out to the author.
- Half-done, unclear, or built differently than the ticket describes → a CONCERN finding explaining the gap in plain terms.
- Changes in the diff that the ticket never asked for (scope creep) → an INFO finding. Not automatically bad, just worth flagging so the author knows you noticed.

Never write in a "Requirement: ... / Status: ..." or checklist/audit-log format — that's not how a person leaves PR feedback. Write each finding as a sentence or two, the way you'd actually say it out loud to the person who opened the PR: direct, specific, no filler, no restating the ticket back at them. Skip a finding entirely if you wouldn't really bother leaving that comment.

Only files with a non-empty "patch" have changes to review. Use "fullContent" as your primary reading material when present, not just "patch", so you understand what the change does in context. "repoTree" is every file path in the repo (structure only) — use it only to check whether something the ticket asks for already exists elsewhere and wasn't touched by this PR.

## Output
Print exactly one complete, self-contained JSON object per finding, on its own line. No markdown, no code fences, no explanation, no wrapping array or {"findings": [...]} envelope:
{"type": "BUG|CONCERN|INFO|STRENGTH", "severity": "critical|high|medium|low", "category": "performance|security|readability|bugs|scalability|best-practices", "file": "exact filename from the input, or the file most relevant to the requirement", "issue": "One or two plain sentences, written like a person, about what you found relative to the ticket. Include the filename naturally, not as a tag.", "recommendation": "What to actually do about it, if anything — skip if there's nothing to add beyond the issue text"}

Pick whichever "category" fits best — most ticket-compliance findings belong under "best-practices" unless the gap is specifically a security, performance, bug, readability, or scalability issue. "file" is required on every finding; if a requirement can't be mapped to one specific file, use the filename most related to it.

## Input (PR files)
${JSON.stringify({ files: context.files, repoTree: context.repoTree, repoTreeTruncated: context.repoTreeTruncated })}`;
}

async function readSseLines(res, onLine) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) onLine(line);
  }
}

async function streamGemini(apiKey, model, prompt, onText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(AI_REVIEW_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API responded ${res.status}: ${errText.trim().slice(0, 200)}`);
  }
  await readSseLines(res, (line) => {
    if (!line.startsWith('data: ')) return;
    const jsonStr = line.slice(6).trim();
    if (!jsonStr) return;
    try {
      const chunk = JSON.parse(jsonStr);
      const text = (chunk?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (text) onText(text);
    } catch { /* partial/invalid SSE frame — skip it */ }
  });
}

async function streamAnthropic(apiKey, model, prompt, onText) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    }),
    signal: AbortSignal.timeout(AI_REVIEW_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API responded ${res.status}: ${errText.trim().slice(0, 200)}`);
  }
  await readSseLines(res, (line) => {
    if (!line.startsWith('data: ')) return;
    const jsonStr = line.slice(6).trim();
    if (!jsonStr) return;
    try {
      const evt = JSON.parse(jsonStr);
      if (evt.type === 'content_block_delta' && evt.delta?.text) onText(evt.delta.text);
    } catch { /* partial/invalid SSE frame — skip it */ }
  });
}

async function streamOpenAICompatible(provider, apiKey, model, prompt, onText) {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      stream: true,
    }),
    signal: AbortSignal.timeout(AI_REVIEW_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`${provider.name} API responded ${res.status}: ${errText.trim().slice(0, 200)}`);
  }
  await readSseLines(res, (line) => {
    if (!line.startsWith('data: ')) return;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const chunk = JSON.parse(payload);
      const text = chunk?.choices?.[0]?.delta?.content;
      if (text) onText(text);
    } catch { /* partial/invalid SSE frame — skip it */ }
  });
}

/**
 * Streams one AI provider's review of `context` (see analyzer.js's
 * buildReviewContext), calling `onText` with each raw text chunk as it
 * arrives — the caller (analyzer.js) feeds these into a JSON-value scanner
 * to pull out individual findings the moment each one completes.
 */
export async function streamReviewFindings({ providerId, apiKey, model, context, onText }) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error('Unknown AI provider');
  const prompt = context.ticketDescription ? buildTicketReviewPrompt(context) : buildReviewPrompt(context);
  if (provider.kind === 'gemini') return streamGemini(apiKey, model, prompt, onText);
  if (provider.kind === 'anthropic') return streamAnthropic(apiKey, model, prompt, onText);
  return streamOpenAICompatible(provider, apiKey, model, prompt, onText);
}
