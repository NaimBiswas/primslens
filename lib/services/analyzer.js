import { isIgnored, applyReviewConfig } from './review-config.js';
import { scanDependencies } from './dependency-scan.js';
import { getRecentDisagreements } from './feedback.js';
import { fetchFileContent, fetchRepoTree } from './github.js';
import { testSkeletonFor } from './test-skeleton.js';
import { createJsonValueScanner } from './json-value-stream.js';
import { getProvider, resolveEnvBackend } from './ai-providers.js';
import { streamReviewFindings } from './ai-review.js';

// `onProgress`, threaded optionally through the analyze* functions below, is
// a `(stage, label, data?) => void` sink for pipeline events — human-readable
// stage transitions (pulling the repo tree, running the AI, ...) as well as
// individual AI findings as they stream in (`data` is the finding object) —
// so callers (the streaming API route, the CLI) can surface real state
// instead of a single opaque "analyzing" spinner. Every call site guards
// with `?.()` so omitting it is a no-op — existing callers/tests unaffected.
function emit(onProgress, stage, label, data) {
  onProgress?.(stage, label, data);
}

// A parsed JSON value counts as one AI finding if it has the shape the
// review agent is prompted to produce — used both to recognize a value
// emitted by the new one-object-per-line contract and to filter out any
// unrelated JSON noise the model might emit alongside it.
function looksLikeFinding(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    (typeof value.issue === 'string' || typeof value.type === 'string');
}

function statsFromFiles(files) {
  return {
    additions: files.reduce((s, f) => s + (f.additions || 0), 0),
    deletions: files.reduce((s, f) => s + (f.deletions || 0), 0),
    filesChanged: files.length,
  };
}

function buildRecommendation(allReviews) {
  const criticalBugs = allReviews.filter((r) => r.type === 'BUG' && r.severity === 'critical').length;
  const highBugs = allReviews.filter((r) => r.type === 'BUG' && r.severity === 'high').length;
  const concerns = allReviews.filter((r) => r.type === 'CONCERN').length;
  if (criticalBugs > 0) return { verdict: 'REJECT', label: 'Reject or Rework', reason: `${criticalBugs} critical security/vulnerability issue(s) must be fixed` };
  if (highBugs > 0) return { verdict: 'REVIEW', label: 'Review Required', reason: `Fix ${highBugs} high-severity bug(s) before merging` };
  if (concerns > 3) return { verdict: 'REVIEW', label: 'Review Required', reason: `Address ${concerns} concern(s) before merging` };
  return { verdict: 'APPROVE', label: 'Approve', reason: 'No critical issues found. Ready to merge' };
}

function prStatusLabel(prData) {
  if (prData.merged) return 'Merged';
  if (prData.state === 'closed') return 'Closed';
  if (prData.draft) return 'Draft';
  return 'Open';
}

function buildResult(prData, files, allReviews, analysisMode, fallbackReason, aiProvider) {
  const stats = statsFromFiles(files);
  const byCategory = (cat) => allReviews.filter((r) => r.category === cat);

  return {
    meta: {
      prTitle: prData.title,
      prAuthor: prData.user?.login,
      prUrl: prData.html_url,
      prNumber: prData.number,
      repo: `${prData.head?.repo?.owner?.login || prData.base?.repo?.owner?.login}/${prData.head?.repo?.name || prData.base?.repo?.name}`,
      branch: prData.head?.ref,
      state: prStatusLabel(prData),
      assignees: (prData.assignees || []).map((a) => a.login),
      stats,
      analysisMode,
      // Which provider actually produced an 'ai' mode review — Gemini,
      // OpenAI, etc. — so the UI/CLI can say more than just "AI".
      aiProvider: aiProvider || null,
      // Only set when analysisMode is 'fallback' due to the AI path failing —
      // why review results can look structurally different from a previous
      // AI-mode run of the same PR (regex heuristics vs. LLM judgment), not a
      // sign of a broken review. See analyzePR's catch in analyzer.js.
      fallbackReason: fallbackReason || null,
    },
    reviews: allReviews,
    strengths: allReviews.filter((r) => r.type === 'STRENGTH'),
    concerns: allReviews.filter((r) => r.type === 'CONCERN'),
    bugs: allReviews.filter((r) => r.type === 'BUG'),
    info: allReviews.filter((r) => r.type === 'INFO'),
    performance: byCategory('performance'),
    security: byCategory('security'),
    readability: byCategory('readability'),
    bugs_cat: byCategory('bugs'),
    scalability: byCategory('scalability'),
    best_practices: byCategory('best-practices'),
    recommendation: buildRecommendation(allReviews),
    files: files.map((f) => ({
      name: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch || '',
    })),
  };
}

const MAX_FULL_CONTENT_FILES = 25;
const MAX_FILE_CONTENT_CHARS = 15000;

/**
 * Full content (not just the diff hunk) of each changed file, so the AI
 * reviews with the surrounding function/module in view instead of only the
 * `+`/`-` lines. Capped in count and size to keep the review bounded and
 * fast; a file that fails to fetch (binary, too large, deleted, transient
 * error) just falls back to patch-only — never blocks the review.
 */
async function fetchFullFileContents(prUrl, token, files) {
  const results = new Map();
  const candidates = files.filter((f) => f.status !== 'removed').slice(0, MAX_FULL_CONTENT_FILES);
  await Promise.all(candidates.map(async (f) => {
    try {
      const { content } = await fetchFileContent(prUrl, token, f.filename);
      results.set(f.filename, content.slice(0, MAX_FILE_CONTENT_CHARS));
    } catch {
      // no full content for this file — the AI still gets its patch
    }
  }));
  return results;
}

// Codebase-wide context: a repo file-tree overview (structure/module
// boundaries) plus full content of every changed file, not just the diff
// hunk — so the review isn't purely change-detection. Best-effort: any
// failure here just means the review falls back to patch-only context.
async function buildReviewContext(prData, analyzableFiles, token, onProgress) {
  let fullContents = new Map();
  let repoTree = null;
  if (token) {
    emit(onProgress, 'codebase-tree', 'Pulling codebase tree & full file contents…');
    [fullContents, repoTree] = await Promise.all([
      fetchFullFileContents(prData.html_url, token, analyzableFiles),
      fetchRepoTree(prData.html_url, token, prData.head?.sha).catch(() => null),
    ]);
  }

  return {
    prTitle: prData.title,
    repoTree: repoTree?.paths || [],
    repoTreeTruncated: !!repoTree?.truncated,
    files: analyzableFiles.map((f) => ({
      filename: f.filename,
      patch: (f.patch || '').slice(0, 10000),
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      fullContent: fullContents.get(f.filename) || null,
    })),
    // Findings reviewers previously marked unhelpful (👎 in the UI) — nudges
    // the AI away from repeating the same low-value flags. See feedback.js.
    avoidPatternsLike: getRecentDisagreements(),
  };
}

// Direct HTTPS call to whichever AI provider is configured — no CLI binary
// to install or ship (that's what broke on Vercel when this used to spawn
// opencode: its file-tracer prunes a dynamically-spawned binary out of the
// deployed function), no subprocess process-management, and no dependence
// on a local credential file that wouldn't survive on a serverless host.
async function analyzeWithAI(prData, files, { providerId, apiKey, model }, config, token, onProgress) {
  const analyzableFiles = files.filter((f) => !isIgnored(f.filename, config?.ignorePaths));
  const context = await buildReviewContext(prData, analyzableFiles, token, onProgress);
  const provider = getProvider(providerId);

  emit(onProgress, 'ai-review', `Reviewing ${context.files.length} changed file(s) with ${provider.name}…`);

  // Findings the model has already streamed back — collected two ways:
  // `streamedFindings` from individual objects the scanner recognizes as a
  // finding (the one-per-line contract every review prompt asks for) as
  // they arrive, `wrapperFindings` from an older `{"findings": [...]}`
  // single-blob shape, in case the model ignores the streaming instruction.
  // Only one of the two is ever populated in practice; both are handled so
  // neither contract silently produces zero findings.
  const streamedFindings = [];
  let wrapperFindings = null;
  const scanner = createJsonValueScanner((value) => {
    if (looksLikeFinding(value)) {
      const finding = { ...value, file: value.file || value.filename || '' };
      streamedFindings.push(finding);
      emit(onProgress, 'ai-finding', finding.issue || 'New finding', finding);
    } else if (value && Array.isArray(value.findings)) {
      wrapperFindings = value.findings.map((f) => ({ ...f, file: f.file || f.filename || '' }));
    } else if (Array.isArray(value)) {
      wrapperFindings = value.map((f) => ({ ...f, file: f.file || f.filename || '' }));
    }
  });

  await streamReviewFindings({
    providerId,
    apiKey,
    model: model || provider.defaultModel,
    context,
    onText: (text) => scanner.push(text),
  });

  const findings = wrapperFindings ?? streamedFindings;
  if (!findings.length) throw new Error(`Invalid or empty response from ${provider.name}`);

  const allReviews = applyReviewConfig([
    ...findings,
    ...checkMissingTests(analyzableFiles),
  ], config);
  return buildResult(prData, files, allReviews, 'ai', null, provider.name);
}

// ─── Fallback: hardcoded regex-based analysis ─────────────────────────────

function getPatchLines(file) {
  if (!file.patch) return [];
  return file.patch.split('\n').filter((l) => l.startsWith('+') || l.startsWith('-'));
}

function getAddedLines(file) {
  if (!file.patch) return [];
  return file.patch.split('\n').filter((l) => l.startsWith('+') && l !== '+\n' && l !== '+');
}

function hasNestedLoops(lines) {
  const loopPattern = /\b(for|while|forEach|map|filter|reduce|some|every)\s*\(/;
  const loopLines = lines.filter((l) => loopPattern.test(l));
  return loopLines.length >= 2;
}

function countOccurrences(lines, pattern) {
  return lines.filter((l) => pattern.test(l)).length;
}

function maxNestingLevel(lines) {
  let maxLevel = 0, currentLevel = 0;
  for (const line of lines) {
    const content = line.startsWith('+') ? line.slice(1) : line;
    const openers = (content.match(/\{/g) || []).length;
    const closers = (content.match(/\}/g) || []).length;
    currentLevel += openers - closers;
    maxLevel = Math.max(maxLevel, currentLevel);
  }
  return maxLevel;
}

function checkPerformance(file, added) {
  const findings = [];
  const name = file.filename;
  if (hasNestedLoops(added)) findings.push({ type: 'CONCERN', severity: 'high', category: 'performance', issue: `Nested loop detected in ${name} — potential O(n²) complexity`, recommendation: 'Flatten loops or use a Map/Set for O(1) lookups' });
  if (added.some((l) => /\.\.\./.test(l)) && added.some((l) => /\b(for|while|forEach|map|filter|reduce)\s*\(/.test(l))) findings.push({ type: 'CONCERN', severity: 'medium', category: 'performance', issue: `Spread operator used in loop context in ${name} — repeated copying may be expensive`, recommendation: 'Move spread operations outside loops or use incremental builds' });
  if (added.some((l) => /console\.(log|dir|table|warn|error)/.test(l))) findings.push({ type: 'CONCERN', severity: 'low', category: 'performance', issue: `Console output in ${name} — avoid in production code`, recommendation: 'Remove or gate behind debug flags' });
  if (countOccurrences(added, /\.\.\.\w+/) > 3) findings.push({ type: 'INFO', severity: 'low', category: 'performance', issue: `Heavy spread usage in ${name} — multiple object/array copies per operation`, recommendation: 'Consider Object.assign() or mutation for performance-critical paths' });
  if (added.some((l) => /JSON\.(stringify|parse)/.test(l) && /data|response|result/.test(l))) findings.push({ type: 'INFO', severity: 'medium', category: 'performance', issue: `JSON serialization of large data in ${name} — may block event loop`, recommendation: 'Use streaming or async parsing for large payloads' });
  return findings;
}

function checkSecurity(file, added) {
  const findings = [];
  const name = file.filename;
  for (const { pattern, label, sev } of [
    { pattern: /innerHTML\s*=/, label: 'innerHTML assignment', sev: 'high' },
    { pattern: /dangerouslySetInnerHTML/, label: 'dangerouslySetInnerHTML usage', sev: 'high' },
    { pattern: /\beval\s*\(/, label: 'eval() usage', sev: 'high' },
    { pattern: /new\s+Function\s*\(/, label: 'new Function() — code injection risk', sev: 'high' },
    { pattern: /\bdocument\.write\s*\(/, label: 'document.write() usage', sev: 'high' },
    { pattern: /exec(File)?\s*\(/, label: 'exec() command execution', sev: 'high' },
    { pattern: /spawn\s*\(/, label: 'spawn() command execution', sev: 'high' },
    { pattern: /child_process/, label: 'child_process module usage', sev: 'high' },
  ]) { if (added.some((l) => pattern.test(l))) findings.push({ type: 'BUG', severity: sev, category: 'security', issue: `${label} in ${name} — possible injection vulnerability`, recommendation: 'Sanitize all inputs and avoid dynamic code execution' }); }
  for (const { pattern, label } of [
    { pattern: /ghp_[\w-]{36,}/, label: 'GitHub token' },
    { pattern: /sk-[\w-]{32,}/, label: 'OpenAI API key' },
    { pattern: /AKIA[0-9A-Z]{16}/, label: 'AWS access key' },
    { pattern: /(?:password|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]+['"]/i, label: 'Hardcoded credential' },
  ]) { if (added.some((l) => pattern.test(l))) findings.push({ type: 'BUG', severity: 'critical', category: 'security', issue: `Potential ${label} hardcoded in ${name}`, recommendation: 'Use environment variables or a secrets manager' }); }
  if (added.some((l) => /\$\{.*?(?:req\.|param|query|body)/.test(l))) findings.push({ type: 'CONCERN', severity: 'high', category: 'security', issue: `User input interpolated into string in ${name} — possible injection`, recommendation: 'Validate and sanitize all user-supplied values' });
  if (added.some((l) => /`[^`]*\$\{[^}]*\}[^`]*`/.test(l) && /(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)/i.test(l))) findings.push({ type: 'BUG', severity: 'critical', category: 'security', issue: `Possible SQL injection in ${name} — template literal in SQL query`, recommendation: 'Use parameterized queries or an ORM' });
  return findings;
}

function checkReadability(file, added) {
  const findings = [];
  const allLines = getPatchLines(file);
  const name = file.filename;
  const addedText = added.join('\n');
  const longLines = added.filter((l) => l.length > 120);
  if (longLines.length > 2) findings.push({ type: 'CONCERN', severity: 'low', category: 'readability', issue: `${longLines.length} lines exceed 120 characters in ${name}`, recommendation: 'Break long lines into smaller, readable chunks' });
  const nesting = maxNestingLevel(allLines);
  if (nesting >= 4) findings.push({ type: 'CONCERN', severity: 'medium', category: 'readability', issue: `Deep nesting (${nesting} levels) in ${name} — hard to follow logic`, recommendation: 'Extract nested blocks into named functions or use early returns' });
  const magicNumbers = added.filter((l) => /[=!<>]=?\s*\d{4,}/.test(l) || /[^a-zA-Z]\d{5,}[^a-zA-Z]/.test(l));
  if (magicNumbers.length > 2) findings.push({ type: 'CONCERN', severity: 'low', category: 'readability', issue: `Magic numbers/constants in ${name} — ${magicNumbers.length} occurrences`, recommendation: 'Extract to named constants for self-documenting code' });
  const singleLetterVars = added.filter((l) => /(?:const|let|var)\s+[a-z]\b/.test(l) && !/\b(for|while|catch)\b/.test(l));
  if (singleLetterVars.length > 2) findings.push({ type: 'INFO', severity: 'low', category: 'readability', issue: `Single-letter variable names in ${name} — hurts readability`, recommendation: 'Use descriptive names even for short-lived variables' });
  const ternaryCount = countOccurrences(added, /\?\s*[^:]*\s*:/);
  if (ternaryCount > 3) findings.push({ type: 'INFO', severity: 'low', category: 'readability', issue: `${ternaryCount} ternary expressions in ${name} — reduce complexity`, recommendation: 'Replace complex ternaries with if/else or switch statements' });
  if (addedText.split('\n').length > 50) findings.push({ type: 'INFO', severity: 'medium', category: 'readability', issue: `Large change block (${addedText.split('\n').length}+ lines) in ${name}`, recommendation: 'Consider splitting into smaller, focused commits' });
  return findings;
}

function checkBugs(file, added) {
  const findings = [];
  const name = file.filename;
  if (isJsLikeFile(name)) {
    const looseEq = added.filter((l) => /==[^=]/.test(l) && !/\/\//.test(l) && !/['"]/.test(l));
    if (looseEq.length > 0) findings.push({ type: 'CONCERN', severity: 'medium', category: 'bugs', issue: `${looseEq.length} loose equality (==) usage${looseEq.length > 1 ? 's' : ''} in ${name}`, recommendation: 'Use === to avoid type-coercion bugs' });
    const nullAccess = added.filter((l) => /\w+\.\w+\.\w+/.test(l) && !/\?\./.test(l) && /[=return(]/.test(l) && !/['"`]/.test(l));
    if (nullAccess.length > 3) findings.push({ type: 'CONCERN', severity: 'medium', category: 'bugs', issue: `Chained property access without optional chaining in ${name} (${nullAccess.length} occurrences)`, recommendation: 'Use optional chaining (?.) to prevent Cannot read property of undefined' });
    const unhandledPromise = added.filter((l) => /\.then\s*\(/.test(l) && !/\.catch\s*\(/.test(l));
    if (unhandledPromise.length > 0) findings.push({ type: 'BUG', severity: 'high', category: 'bugs', issue: `${unhandledPromise.length} .then() without .catch() in ${name} — unhandled rejection`, recommendation: 'Add .catch() or use async/await with try-catch' });
    const nanComparison = added.some((l) => /===?\s*NaN/.test(l) || /NaN\s*===?/.test(l));
    if (nanComparison) findings.push({ type: 'BUG', severity: 'high', category: 'bugs', issue: `NaN comparison in ${name} — NaN !== NaN, use isNaN() instead`, recommendation: 'Use Number.isNaN() to check for NaN values' });
  }
  return findings;
}

function checkScalability(file, added) {
  const findings = [];
  const name = file.filename;
  if (isJsLikeFile(name)) {
    const asyncForEach = added.filter((l) => /forEach\s*\(/.test(l) && /async/.test(l));
    if (asyncForEach.length > 0) findings.push({ type: 'BUG', severity: 'high', category: 'scalability', issue: `async forEach in ${name} — N+1 issue, Promises fire concurrently without control`, recommendation: 'Use for...of with async/await or Promise.all() for controlled parallelism' });
    const syncIO = added.filter((l) => /(readFileSync|writeFileSync|existsSync|mkdirSync|readdirSync)/.test(l));
    if (syncIO.length > 0) findings.push({ type: 'CONCERN', severity: 'high', category: 'scalability', issue: `Synchronous I/O in ${name} (${syncIO.length} call(s)) — blocks the entire process`, recommendation: 'Use async I/O methods for non-blocking operation' });
    if (added.some((l) => /(addEventListener|on\s*\()/.test(l)) && !added.some((r) => /removeEventListener|off\s*\(/.test(r))) findings.push({ type: 'INFO', severity: 'medium', category: 'scalability', issue: `Event listener(s) added in ${name} without cleanup — risk of memory leaks`, recommendation: 'Always remove event listeners on unmount/dispose' });
  }
  if (added.some((l) => /\.(sort|filter|map|reduce)\s*\(/.test(l) && /(all|every|list|items|data|records|rows)/i.test(l))) findings.push({ type: 'INFO', severity: 'medium', category: 'scalability', issue: `In-memory array operations on potentially large dataset in ${name}`, recommendation: 'Consider database-level pagination and server-side filtering' });
  const hardcodedLimits = added.filter((l) => /\.limit\s*\(/.test(l) || /pageSize\s*=\s*\d{2,4}/.test(l) || /timeout\s*=\s*\d{2,6}/.test(l));
  if (hardcodedLimits.length > 0) findings.push({ type: 'INFO', severity: 'low', category: 'scalability', issue: `Hardcoded limits/timeouts in ${name} — may not suit all environments`, recommendation: 'Make limits configurable via environment variables' });
  return findings;
}

function checkBestPractices(file, added) {
  const findings = [];
  const name = file.filename;
  const todos = added.filter((l) => /\/\/\s*(TODO|FIXME|HACK|XXX|WORKAROUND)/i.test(l));
  if (todos.length > 0) findings.push({ type: 'CONCERN', severity: 'low', category: 'best-practices', issue: `${todos.length} TODO/FIXME/HACK comment(s) in ${name}`, recommendation: 'Address technical debt before merging' });
  if (!isJsLikeFile(name)) return findings;
  for (const { pattern, label } of [
    { pattern: /componentWillMount|componentWillUpdate|componentWillReceiveProps/, label: 'deprecated React lifecycle' },
    { pattern: /findDOMNode/, label: 'findDOMNode (deprecated in React)' },
    { pattern: /\.render\s*\(/, label: 'ReactDOM.render (deprecated in React 18+)' },
    { pattern: /require\s*\(/, label: 'require() instead of import' },
    { pattern: /process\.env\.NODE_ENV\s*===?\s*'production'/, label: 'manual env check (use conditional imports)' },
  ]) { if (added.some((l) => pattern.test(l))) findings.push({ type: 'INFO', severity: 'low', category: 'best-practices', issue: `${label} pattern in ${name}`, recommendation: 'Use modern API alternatives for better maintainability' }); }
  const asyncWithoutTryCatch = added.filter((l) => /async\s+\w+\s*\(/.test(l) && !added.some((r) => /try\s*\{/.test(r)));
  if (asyncWithoutTryCatch.length > 0) findings.push({ type: 'CONCERN', severity: 'high', category: 'best-practices', issue: `Async functions without try-catch in ${name}`, recommendation: 'Wrap async logic in try-catch to handle rejections gracefully' });
  if (added.some((l) => /(req\.body|req\.params|req\.query)/.test(l)) && !added.some((r) => /\b(validate|sanitize|assert|check|Joi|z\.)/.test(r))) findings.push({ type: 'CONCERN', severity: 'medium', category: 'best-practices', issue: `Request data accessed without validation in ${name}`, recommendation: 'Validate all input with a schema library (Joi, Zod, etc.)' });
  if (added.some((l) => /this\.state\.\w+\s*=/.test(l) || /\.state\s*=\s*\{/.test(l))) findings.push({ type: 'BUG', severity: 'high', category: 'best-practices', issue: `Direct state mutation in ${name} — use setState() instead`, recommendation: 'Always use setState() or a state management library' });
  if ((name.endsWith('.jsx') || name.endsWith('.tsx')) && added.some((l) => /\.map\s*\(/.test(l)) && !added.some((r) => /key=\{/.test(r))) findings.push({ type: 'CONCERN', severity: 'medium', category: 'best-practices', issue: `.map() in JSX without key prop in ${name}`, recommendation: 'Add a unique key prop to each rendered element in .map()' });
  return findings;
}

const TEST_FILE_PATTERN = /(\.(test|spec)\.[jt]sx?$)|(_test\.py$)|(test_[^/]+\.py$)|(\/__tests__\/)|(\/tests?\/)/i;
const CODE_FILE_PATTERN = /\.(js|jsx|ts|tsx|py|go|rb|java|rs)$/i;
const JS_LIKE_PATTERN = /\.(js|jsx|ts|tsx|mjs|cjs)$/i;
const SUBSTANTIAL_ADDITION_THRESHOLD = 15;

// Several fallback checks encode JS/TS-specific idioms (== coercion, optional
// chaining, React APIs, Node sync I/O). Applying them to Go/Python/Rust/etc.
// produces false-positive "bugs" since those languages use == idiomatically and
// have no ?. / React / readFileSync. Gate those checks behind this predicate so
// non-JS files only get the language-agnostic findings.
function isJsLikeFile(name) {
  return JS_LIKE_PATTERN.test(name);
}

/**
 * PR-level check (not per-file): flags a PR that adds meaningful new code
 * but touches no test file at all. Deliberately one finding for the whole
 * PR, not per-file noise, and folded into best-practices rather than a new
 * top-level dimension — the product is documented everywhere as "6
 * dimensions."
 */
function primaryCodeFile(codeFiles) {
  return codeFiles.reduce((best, f) => ((f.additions || 0) > (best?.additions || 0) ? f : best), null);
}

function checkMissingTests(files) {
  const touchesTestFile = files.some((f) => TEST_FILE_PATTERN.test(f.filename));
  if (touchesTestFile) return [];

  const codeFiles = files.filter((f) => CODE_FILE_PATTERN.test(f.filename) && !TEST_FILE_PATTERN.test(f.filename));
  const substantialAdditions = codeFiles.reduce((sum, f) => sum + (f.additions || 0), 0);
  if (substantialAdditions < SUBSTANTIAL_ADDITION_THRESHOLD) return [];

  const primary = primaryCodeFile(codeFiles);
  const skeleton = primary ? testSkeletonFor(primary.filename) : '';
  const recommendation = skeleton
    ? `Add or update tests covering the new behavior before merging.\n\nSuggested test — alongside ${primary.filename}:\n\n${skeleton}`
    : 'Add or update tests covering the new behavior before merging';

  return [{
    type: 'CONCERN',
    severity: 'medium',
    category: 'best-practices',
    issue: `${substantialAdditions} line(s) of new code added across ${codeFiles.length} file(s) with no accompanying test file`,
    recommendation,
  }];
}

function analyzeFileFallback(file) {
  if (!file.patch) return [];
  const added = getAddedLines(file);
  if (!added.length) return [];
  const findings = [
    ...checkPerformance(file, added),
    ...checkSecurity(file, added),
    ...checkReadability(file, added),
    ...checkBugs(file, added),
    ...checkScalability(file, added),
    ...checkBestPractices(file, added),
  ];
  return findings.map((f) => ({ ...f, file: file.filename }));
}

function analyzeFallback(prData, files, config, onProgress, fallbackReason) {
  const analyzableFiles = files.filter((f) => !isIgnored(f.filename, config?.ignorePaths));
  emit(onProgress, 'pattern-review', `Running pattern-based analysis across ${analyzableFiles.length} file(s)…`);
  const allReviews = applyReviewConfig(
    [...analyzableFiles.flatMap(analyzeFileFallback), ...checkMissingTests(analyzableFiles)],
    config
  );
  return buildResult(prData, files, allReviews, 'fallback', fallbackReason);
}

// ─── Main export ─────────────────────────────────────────────────────────

export { analyzeFallback };

function mergeFindings(result, extraFindings) {
  if (!extraFindings.length) return result;
  const reviews = [...result.reviews, ...extraFindings];
  const byType = (type) => reviews.filter((r) => r.type === type);
  const byCategory = (cat) => reviews.filter((r) => r.category === cat);
  return {
    ...result,
    reviews,
    strengths: byType('STRENGTH'),
    concerns: byType('CONCERN'),
    bugs: byType('BUG'),
    info: byType('INFO'),
    performance: byCategory('performance'),
    security: byCategory('security'),
    readability: byCategory('readability'),
    bugs_cat: byCategory('bugs'),
    scalability: byCategory('scalability'),
    best_practices: byCategory('best-practices'),
  };
}

/**
 * `config` is the optional per-repo `.prismlens.json` (see review-config.js)
 * — ignore paths, severity overrides, disabled checks. `token`, when
 * provided, additionally runs a dependency-vulnerability scan (OSV.dev)
 * against package.json and folds any findings into the `security`
 * category — deterministic and independent of AI vs. fallback mode, so it
 * always runs when a token is available, layered on after either path.
 */
export async function analyzePR(prData, files, config, token, onProgress, aiOverride) {
  // `aiOverride` reflects an explicit choice made in the Model page's
  // unified model picker (stored client-side, sent per-request):
  //   - { providerId, apiKey, model } — user picked a specific provider's
  //     model; use their own key, regardless of what the server has configured.
  //   - { disabled: true } — user explicitly asked for no AI backend (the
  //     regex fallback), which must be honored even if the server has its
  //     own provider key configured — an explicit choice is never silently
  //     overridden.
  //   - null/undefined — no explicit choice made anywhere; fall back to
  //     whichever provider the server itself has an env key for.
  const backend = aiOverride?.disabled
    ? null
    : aiOverride?.providerId && aiOverride?.apiKey
      ? aiOverride
      : resolveEnvBackend();

  let result;
  let fallbackReason;
  if (backend) {
    try {
      result = await analyzeWithAI(prData, files, backend, config, token, onProgress);
    } catch (err) {
      console.warn(`${backend.providerId} analysis failed, using fallback:`, err.message);
      fallbackReason = err.message;
      emit(onProgress, 'pattern-review-fallback', `AI review unavailable (${err.message}) — falling back to pattern-based analysis…`);
    }
  } else {
    fallbackReason = 'no AI backend configured — connect a provider key in the Model page';
  }
  if (!result) result = analyzeFallback(prData, files, config, onProgress, fallbackReason);

  if (token) {
    emit(onProgress, 'dep-scan', 'Checking dependencies for known vulnerabilities…');
    try {
      const depFindings = await scanDependencies(prData.html_url, token, files);
      result = mergeFindings(result, depFindings);
    } catch (err) {
      console.warn('Dependency scan failed:', err.message);
    }
  }

  emit(onProgress, 'done', 'Finalizing report…');
  return result;
}
