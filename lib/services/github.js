import axios from 'axios';

const GITHUB_BASE_URL = 'https://api.github.com';
const GITHUB_HEADERS = (token) => ({
  'Authorization': `Bearer ${token}`,
  'Accept': 'application/vnd.github.v3+json',
});

export const parsePRUrl = (prUrl) => {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) throw new Error('Invalid PR URL. Use: https://github.com/user/repo/pull/123');
  return { owner: match[1], repo: match[2], prNumber: match[3] };
};

export const fetchPR = async (prUrl, token) => {
  const { owner, repo, prNumber } = parsePRUrl(prUrl);
  const res = await axios.get(
    `${GITHUB_BASE_URL}/repos/${owner}/${repo}/pulls/${prNumber}`,
    { headers: GITHUB_HEADERS(token) }
  );
  return res.data;
};

export const fetchPRFiles = async (prUrl, token) => {
  const { owner, repo, prNumber } = parsePRUrl(prUrl);
  const res = await axios.get(
    `${GITHUB_BASE_URL}/repos/${owner}/${repo}/pulls/${prNumber}/files`,
    { headers: GITHUB_HEADERS(token) }
  );
  return res.data;
};

export const fetchPRCommits = async (prUrl, token) => {
  const { owner, repo, prNumber } = parsePRUrl(prUrl);
  const res = await axios.get(
    `${GITHUB_BASE_URL}/repos/${owner}/${repo}/pulls/${prNumber}/commits`,
    { headers: GITHUB_HEADERS(token) }
  );
  return res.data;
};

const MAX_TREE_PATHS = 300;

/**
 * Repo-wide file-path listing (not content) at a given commit, so review can
 * be grounded in the codebase's actual structure — module boundaries,
 * naming conventions, where similar code already lives — rather than the
 * PR's diff in isolation. Capped well below GitHub's own 100k-entry ceiling
 * to keep the AI's context bounded; `truncated` tells the caller when the
 * repo has more files than were included.
 */
export const fetchRepoTree = async (prUrl, token, sha) => {
  const { owner, repo } = parsePRUrl(prUrl);
  const res = await axios.get(
    `${GITHUB_BASE_URL}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    { headers: GITHUB_HEADERS(token) }
  );
  const paths = (res.data.tree || [])
    .filter((entry) => entry.type === 'blob')
    .map((entry) => entry.path);
  return {
    paths: paths.slice(0, MAX_TREE_PATHS),
    truncated: !!res.data.truncated || paths.length > MAX_TREE_PATHS,
  };
};

const mapVerdictToEvent = (verdict) => {
  switch (verdict) {
    case 'APPROVE': return 'APPROVE';
    case 'REJECT': return 'REQUEST_CHANGES';
    default: return 'COMMENT';
  }
};

export const postPRReview = async (prUrl, token, reviewData, event, footer) => {
  const { owner, repo, prNumber } = parsePRUrl(prUrl);

  const body = generateReviewBody(reviewData) + (footer || '');

  const res = await axios.post(
    `${GITHUB_BASE_URL}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
    { body, event: event || 'COMMENT' },
    { headers: GITHUB_HEADERS(token) }
  );
  return res.data;
};

export const fetchFileContent = async (prUrl, token, path) => {
  const { owner, repo } = parsePRUrl(prUrl);
  const pr = await fetchPR(prUrl, token);
  const ref = pr.head?.ref;
  const res = await axios.get(
    `${GITHUB_BASE_URL}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`,
    { headers: GITHUB_HEADERS(token) }
  );
  return {
    content: Buffer.from(res.data.content, 'base64').toString('utf-8'),
    sha: res.data.sha,
    encoding: res.data.encoding,
  };
};

export const commitFile = async (prUrl, token, path, content, message) => {
  const { owner, repo } = parsePRUrl(prUrl);
  const pr = await fetchPR(prUrl, token);
  const branch = pr.head?.ref;

  let sha;
  try {
    const existing = await axios.get(
      `${GITHUB_BASE_URL}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`,
      { headers: GITHUB_HEADERS(token) }
    );
    sha = existing.data.sha;
  } catch {}

  const body = {
    message,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    branch,
  };
  if (sha) body.sha = sha;

  const res = await axios.put(
    `${GITHUB_BASE_URL}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    body,
    { headers: GITHUB_HEADERS(token) }
  );
  return res.data;
};

// Severity ranking used to sort findings by how much they matter (highest
// first) when picking which ones to lead the review comment with.
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

// Findings identify their file loosely — exact path, bare basename, or a
// path suffix (AI-mode findings aren't guaranteed to echo the diff's exact
// path string) — so treat any of those as the same file.
function sameFile(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const baseA = a.split(/[\\/]/).pop();
  const baseB = b.split(/[\\/]/).pop();
  if (baseA === baseB) return true;
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

// A finding's `file` can be missing (older AI-review output never filled it
// in) or vaguely phrased. Falls back to pulling it out of the issue text,
// then — if this PR only touches one file — assumes that file, since there's
// nowhere else it could be, then finally checks whether any changed file's
// path is mentioned in the issue text at all.
function resolveFindingFile(item, files) {
  if (item.file) return item.file;
  const fromIssue = extractFileFromIssue(item.issue || '');
  if (fromIssue) return fromIssue;
  if (files && files.length === 1) return files[0].name;
  const hit = (files || []).find((f) => (item.issue || '').includes(f.name));
  return hit ? hit.name : '';
}

// Pulls out the first added line from a patch that actually says something
// (skips blank lines and bare punctuation like `{`, `};`, `)`) so the
// Changes section can quote real diff content as its "why" instead of a
// generic "modified" label — grounded in what the file actually shows,
// never an invented explanation.
function significantPatchLine(patch) {
  if (!patch) return '';
  const line = patch
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1).trim())
    .find((l) => l.length > 1 && /[a-zA-Z0-9]/.test(l) && !/^[{}()[\];,]+$/.test(l));
  if (!line) return '';
  return line.length > 100 ? `${line.slice(0, 100)}…` : line;
}

function fileStatusNote(file) {
  if (file.status === 'renamed') return 'File renamed.';
  if (file.status === 'removed') return 'File removed.';
  const line = significantPatchLine(file.patch);
  if (file.status === 'added') {
    return line ? `New file — adds \`${line}\`.` : 'New file added.';
  }
  return line ? `Updated — now includes \`${line}\`.` : 'Modified as part of this change.';
}

// Local copy of the test-file heuristic (also used in analyzer.js) so the
// PR description can report which test files this PR touches.
const TEST_FILE_PATTERN = /(\.(test|spec)\.[jt]sx?$)|(_test\.(py|rb|go|java|rs)$)|(test_[^/]+\.py$)|(\/__tests__\/)|(\/tests?\/)/i;

const ISSUE_REF_PATTERN = /(?:fixes?|closes?|resolves?|refs?|see)\s+#(\d+)|#(\d+)/gi;

// Returns the names of test files changed in this PR (if any).
function testFilesInPR(review) {
  return (review.files || []).filter((f) => TEST_FILE_PATTERN.test(f.name)).map((f) => f.name);
}

// Surfaces the "no tests" finding (if the analysis produced one) so the
// description can warn that the change ships without test coverage.
function missingTestWarning(review) {
  for (const item of review.best_practices || []) {
    const text = `${item.issue || ''} ${item.recommendation || ''}`;
    if (/no\s+(?:accompanying\s+)?test file|missing[- ]test|touches no test/i.test(text)) {
      return item.recommendation || item.issue;
    }
  }
  return null;
}

// checkMissingTests embeds a ready-to-use test skeleton inside its
// `recommendation` (see SUGGESTED_TEST_MARKER below), as plain text. Pull it
// out into a real, language-tagged code fence so it renders highlighted
// instead of as an unformatted blob.
function renderTestSuggestionMarkdown(text) {
  if (!text) return '';
  const idx = text.indexOf(SUGGESTED_TEST_MARKER);
  if (idx === -1) return text;
  const prose = text.slice(0, idx).replace(/\s+$/, '');
  const rest = text.slice(idx + SUGGESTED_TEST_MARKER.length);
  const colon = rest.indexOf(':');
  const fname = colon !== -1 ? rest.slice(0, colon).trim() : '';
  const code = colon !== -1 ? rest.slice(colon + 1).replace(/^\s+/, '') : '';
  let out = prose;
  if (fname) out += `\n\nSuggested test — alongside \`${fname}\`:`;
  if (code) out += '\n\n```' + langFromFilename(fname) + '\n' + code.replace(/\s+$/, '') + '\n```';
  return out;
}

// Pulls issue references (e.g. "fixes #123", "#45") out of the PR title/branch.
function relatedIssues(review) {
  const text = `${review.meta?.prTitle || ''} ${review.meta?.branch || ''}`;
  const refs = new Set();
  let m;
  while ((m = ISSUE_REF_PATTERN.exec(text))) refs.add(`#${m[1] || m[2]}`);
  return [...refs];
}

// File-grouping buckets for the "Changes" section, ordered by how the
// example format reads a PR: CI/tooling first (usually the smallest, most
// mechanical change), then dependency/build config, then tests, then
// everything else. Purely extension/path based — no guessing at intent
// beyond what the path itself tells you.
const CI_FILE_PATTERN = /(^|\/)\.github\/workflows\/|(^|\/)\.circleci\/|(^|\/)\.gitlab-ci\.ya?ml$|(^|\/)azure-pipelines\.ya?ml$|(^|\/)Jenkinsfile$/i;
const BUILD_CONFIG_PATTERN = /(^|\/)(package(-lock)?\.json|\.nvmrc|\.npmrc|tsconfig.*\.json|\.eslintrc.*|\.prettierrc.*|Dockerfile.*|docker-compose.*\.ya?ml|Makefile|pyproject\.toml|requirements.*\.txt|Gemfile.*|go\.(mod|sum)|Cargo\.(toml|lock)|\.prismlens\.json)$/i;

function categorizeFile(name) {
  if (CI_FILE_PATTERN.test(name)) return 'ci';
  if (TEST_FILE_PATTERN.test(name)) return 'tests';
  if (BUILD_CONFIG_PATTERN.test(name)) return 'build';
  return 'source';
}

const CHANGE_GROUPS = [
  { key: 'ci', label: 'CI / Workflows' },
  { key: 'build', label: 'Build & Dependencies' },
  { key: 'tests', label: 'Tests' },
  { key: 'source', label: 'Source' },
];

// Every changed file falls in the ci/build/tests buckets, none in source —
// mirrors the "as expected for a config-only PR with no source changes" call-out
// a human reviewer would make, stated as what the diff shows, not a claim
// about runtime behavior we haven't actually verified.
function isConfigOnly(files) {
  return (files || []).length > 0 && files.every((f) => categorizeFile(f.name) !== 'source');
}

// The pasted ticket can be arbitrarily long (a full story with acceptance
// criteria, discussion, etc.) — the Description section wants the "why" in
// about 3-4 lines, not the whole thing verbatim. Keeps the ticket's own
// leading sentences (still the user's own words, just trimmed) rather than
// summarizing/rewriting them.
const TICKET_SUMMARY_MAX_SENTENCES = 4;
const TICKET_SUMMARY_MAX_CHARS = 600;

function condenseTicket(text) {
  const clean = (text || '').trim();
  if (!clean) return '';
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  let summary = sentences.slice(0, TICKET_SUMMARY_MAX_SENTENCES).join(' ');
  if (summary.length > TICKET_SUMMARY_MAX_CHARS) {
    summary = `${summary.slice(0, TICKET_SUMMARY_MAX_CHARS).replace(/\s+\S*$/, '')}…`;
  }
  return summary;
}

export function generateDescription(review) {
  const { meta, files = [] } = review;
  const issues = relatedIssues(review);
  const configOnly = isConfigOnly(files);

  let md = `## PR Title\n\n`;
  md += `${meta.prTitle}\n\n`;

  md += `## Description\n\n`;
  // When the review was scoped to a pasted ticket (see analyzePR's
  // `ticketDescription` param), the description is based on that ticket —
  // the user's own words for "why", carried through in meta.ticketDescription
  // — rather than reconstructed from the diff. The stats line still follows
  // for concrete file/line counts, which the ticket text itself won't have.
  if (meta.ticketDescription) md += `${condenseTicket(meta.ticketDescription)}\n\n`;
  md += `Touches **${meta.stats.filesChanged}** file(s) (+${meta.stats.additions}/-${meta.stats.deletions}) on \`${meta.branch || '?'}\`.`;
  if (configOnly) md += ' Configuration/tooling only — no application source files changed.';
  if (issues.length) md += ` (refs: ${issues.join(', ')})`;
  md += '\n\n';

  md += `## Changes\n\n`;
  for (const group of CHANGE_GROUPS) {
    const groupFiles = files.filter((f) => categorizeFile(f.name) === group.key);
    if (!groupFiles.length) continue;
    md += `### ${group.label}\n\n`;
    for (const f of groupFiles) {
      // Plain, factual note — what changed, not a judgment on it. Review
      // findings (bugs/concerns/severity) belong in the posted review
      // comment (generateReviewBody), not in a PR description written from
      // the author's point of view.
      md += `- \`${f.name}\` (+${f.additions || 0}/-${f.deletions || 0}) — ${fileStatusNote(f)}\n`;
    }
    md += '\n';
  }

  const testFiles = testFilesInPR(review);
  const missingTest = testFiles.length === 0 ? missingTestWarning(review) : null;

  // Only write a Verification section when there's something concrete to
  // say — test files actually touched, or a real missing-test finding.
  // A PR with neither gets no section at all rather than a filler line
  // like "No test files were changed", which reads as generated noise, not
  // something a reviewer would bother writing down.
  if (testFiles.length) {
    md += `## Verification\n\n`;
    md += `- Test file(s) touched: ${testFiles.map((tf) => `\`${tf}\``).join(', ')}.\n\n`;
    for (const tf of testFiles) {
      const patch = files.find((f) => f.name === tf)?.patch;
      if (patch) md += '```' + langFromFilename(tf) + '\n' + patch.trim() + '\n```\n\n';
    }
  } else if (missingTest) {
    md += `## Verification\n\n`;
    md += `${renderTestSuggestionMarkdown(missingTest)}\n`;
  }

  return md;
}

export const updatePRDescription = async (prUrl, token, review) => {
  const { owner, repo, prNumber } = parsePRUrl(prUrl);
  const body = generateDescription(review);
  const res = await axios.patch(
    `${GITHUB_BASE_URL}/repos/${owner}/${repo}/pulls/${prNumber}`,
    { body },
    { headers: GITHUB_HEADERS(token) }
  );
  return res.data;
};

const SIZE_THRESHOLDS = [
  { max: 20, label: 'size/XS' },
  { max: 100, label: 'size/S' },
  { max: 400, label: 'size/M' },
  { max: 1000, label: 'size/L' },
  { max: Infinity, label: 'size/XL' },
];

const LABEL_COLORS = {
  'size/XS': 'c2e0c6', 'size/S': 'c2e0c6', 'size/M': 'fef2c0', 'size/L': 'f9c99f', 'size/XL': 'e99695',
  'risk/low': 'c2e0c6', 'risk/medium': 'fef2c0', 'risk/high': 'e99695',
};

export function computeLabels(review) {
  const total = (review.meta?.stats?.additions || 0) + (review.meta?.stats?.deletions || 0);
  const sizeLabel = SIZE_THRESHOLDS.find((t) => total <= t.max).label;

  const criticalBugs = (review.bugs || []).filter((r) => r.severity === 'critical').length;
  const highBugs = (review.bugs || []).filter((r) => r.severity === 'high').length;
  const riskLabel = criticalBugs > 0 ? 'risk/high' : highBugs > 0 || review.recommendation?.verdict === 'REVIEW' ? 'risk/medium' : 'risk/low';

  return [sizeLabel, riskLabel];
}

async function ensureLabelsExist(owner, repo, token, labels) {
  for (const name of labels) {
    try {
      await axios.post(
        `${GITHUB_BASE_URL}/repos/${owner}/${repo}/labels`,
        { name, color: LABEL_COLORS[name] || 'ededed' },
        { headers: GITHUB_HEADERS(token) }
      );
    } catch (err) {
      if (err.response?.status !== 422) throw err; // 422 = label already exists, fine
    }
  }
}

export const applyLabels = async (prUrl, token, labels) => {
  const { owner, repo, prNumber } = parsePRUrl(prUrl);
  await ensureLabelsExist(owner, repo, token, labels);
  const res = await axios.post(
    `${GITHUB_BASE_URL}/repos/${owner}/${repo}/issues/${prNumber}/labels`,
    { labels },
    { headers: GITHUB_HEADERS(token) }
  );
  return res.data;
};

export const mergePR = async (prUrl, token, mergeMethod = 'merge') => {
  const { owner, repo, prNumber } = parsePRUrl(prUrl);
  const res = await axios.put(
    `${GITHUB_BASE_URL}/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
    { merge_method: mergeMethod },
    { headers: GITHUB_HEADERS(token) }
  );
  return res.data;
};

export const fetchAuthenticatedUser = async (token) => {
  const res = await axios.get(`${GITHUB_BASE_URL}/user`, { headers: GITHUB_HEADERS(token) });
  return res.data;
};

export const replyToReviewComment = async (prUrl, token, commentId, body) => {
  const { owner, repo, prNumber } = parsePRUrl(prUrl);
  const res = await axios.post(
    `${GITHUB_BASE_URL}/repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies`,
    { body },
    { headers: GITHUB_HEADERS(token) }
  );
  return res.data;
};

export const postIssueComment = async (prUrl, token, body) => {
  const { owner, repo, prNumber } = parsePRUrl(prUrl);
  const res = await axios.post(
    `${GITHUB_BASE_URL}/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    { body },
    { headers: GITHUB_HEADERS(token) }
  );
  return res.data;
};

const CATEGORIES = [
  { key: 'performance', label: 'Performance' },
  { key: 'security', label: 'Security' },
  { key: 'readability', label: 'Readability' },
  { key: 'bugs_cat', label: 'Bugs' },
  { key: 'scalability', label: 'Scalability' },
  { key: 'best_practices', label: 'Best Practices' },
];

function performanceSuggestion(item) {
  const issue = item.issue.toLowerCase();
  if (issue.includes('nested loop')) {
    return [
      'Consider replacing nested loops with a lookup structure to reduce time complexity from O(n\u00B7m) to O(n+m):',
      '',
      '```suggestion',
      '// Before: nested loop',
      'for (const a of listA) {',
      '  for (const b of listB) {',
      '    if (a.id === b.ref) { /* ... */ }',
      '  }',
      '}',
      '',
      '// After: Map lookup (O(n+m))',
      'const lookup = new Map(listB.map(b => [b.ref, b]));',
      'for (const a of listA) {',
      '  const b = lookup.get(a.id);',
      '  if (b) { /* ... */ }',
      '}',
      '```',
    ].join('\n');
  }
  if (issue.includes('spread operator')) {
    return [
      'Move spread operations outside the loop to avoid repeated allocations:',
      '',
      '```suggestion',
      '// Instead of spreading inside a loop:',
      'const merged = [];',
      'for (const item of items) {',
      '  merged.push(...item.values);  // allocates per iteration',
      '}',
      '',
      '// Use push with spread or concat outside:',
      'const allValues = items.flatMap(item => item.values);',
      '```',
    ].join('\n');
  }
  if (issue.includes('console')) {
    return [
      'Remove or guard console output in production paths:',
      '',
      '```suggestion',
      '// Replace:',
      'console.log(\'Processing:\', data);',
      '',
      '// With a conditional logger:',
      'if (process.env.DEBUG) {',
      '  console.log(\'Processing:\', data);',
      '}',
      '```',
    ].join('\n');
  }
  if (issue.includes('heavy spread') || issue.includes('spread usage')) {
    return [
      'For performance-critical hot paths, prefer mutation over spread to reduce GC pressure:',
      '',
      '```suggestion',
      '// Instead of:',
      'const updated = { ...state, ...payload };',
      '',
      '// Consider Object.assign for clarity:',
      'const updated = Object.assign({}, state, payload);',
      '// Or use explicit property assignment in hot paths',
      '```',
    ].join('\n');
  }
  if (issue.includes('json')) {
    return [
      'Large JSON operations can block the event loop. Use streaming when possible:',
      '',
      '```suggestion',
      '// For large payloads, prefer streaming:',
      'const { Transform } = require(\'stream\');',
      '',
      '// Or offload to a worker thread for synchronous parsing:',
      'const { Worker } = require(\'worker_threads\');',
      '```',
    ].join('\n');
  }
  return '';
}

function securitySuggestion(item) {
  const issue = item.issue.toLowerCase();
  if (issue.includes('eval() usage') || issue.includes('new function()')) {
    return [
      'Avoid executing dynamic strings as code — parse data instead:',
      '',
      '```suggestion',
      '// Instead of:',
      'eval(userInput);',
      '',
      '// Parse as data, never execute:',
      'const value = JSON.parse(userInput);',
      '```',
    ].join('\n');
  }
  if (issue.includes('innerhtml') || issue.includes('dangerouslysetinnerhtml')) {
    return [
      'Render text content instead of raw HTML to avoid XSS:',
      '',
      '```suggestion',
      '// Instead of:',
      'el.innerHTML = userContent;',
      '',
      '// Set text content, or sanitize first:',
      'el.textContent = userContent;',
      '```',
    ].join('\n');
  }
  if (issue.includes('hardcoded') || issue.includes('credential')) {
    return [
      'Move the secret out of source and read it from the environment:',
      '',
      '```suggestion',
      '// Instead of:',
      'const apiKey = "sk-abc123...";',
      '',
      '// Read from environment/secret manager:',
      'const apiKey = process.env.API_KEY;',
      '```',
    ].join('\n');
  }
  if (issue.includes('sql injection')) {
    return [
      'Use parameterized queries instead of string interpolation:',
      '',
      '```suggestion',
      '// Instead of:',
      'db.query(`SELECT * FROM users WHERE id = ${id}`);',
      '',
      '// Parameterize:',
      'db.query(\'SELECT * FROM users WHERE id = ?\', [id]);',
      '```',
    ].join('\n');
  }
  if (issue.includes('interpolated into string')) {
    return [
      'Validate and sanitize user input before it reaches a string that gets executed or rendered:',
      '',
      '```suggestion',
      '// Validate/allowlist before interpolating:',
      'if (!ALLOWED.has(value)) throw new Error(\'invalid value\');',
      '```',
    ].join('\n');
  }
  return '';
}

function bugsSuggestion(item) {
  const issue = item.issue.toLowerCase();
  if (issue.includes('loose equality')) {
    return [
      'Use strict equality to avoid type-coercion surprises:',
      '',
      '```suggestion',
      '// Instead of:',
      'if (value == null) { /* ... */ }',
      '',
      '// Use strict equality:',
      'if (value === null || value === undefined) { /* ... */ }',
      '```',
    ].join('\n');
  }
  if (issue.includes('optional chaining')) {
    return [
      'Use optional chaining for deep property access that might be missing:',
      '',
      '```suggestion',
      '// Instead of:',
      'const city = user.address.city;',
      '',
      '// Guard the chain:',
      'const city = user?.address?.city;',
      '```',
    ].join('\n');
  }
  if (issue.includes('.then() without .catch()') || issue.includes('unhandled rejection')) {
    return [
      'Handle rejections explicitly:',
      '',
      '```suggestion',
      '// Instead of:',
      'fetchData().then((data) => use(data));',
      '',
      '// Add a .catch(), or use try/catch with await:',
      'fetchData().then((data) => use(data)).catch((err) => handle(err));',
      '```',
    ].join('\n');
  }
  if (issue.includes('nan comparison')) {
    return [
      'NaN is never equal to itself — check for it explicitly:',
      '',
      '```suggestion',
      '// Instead of:',
      'if (value === NaN) { /* never true */ }',
      '',
      '// Use Number.isNaN:',
      'if (Number.isNaN(value)) { /* ... */ }',
      '```',
    ].join('\n');
  }
  return '';
}

function scalabilitySuggestion(item) {
  const issue = item.issue.toLowerCase();
  if (issue.includes('async foreach')) {
    return [
      'forEach doesn’t await its callback — promises fire uncontrolled. Use a controlled loop instead:',
      '',
      '```suggestion',
      '// Instead of:',
      'items.forEach(async (item) => { await process(item); });',
      '',
      '// Sequential:',
      'for (const item of items) { await process(item); }',
      '// Or bounded parallel:',
      'await Promise.all(items.map((item) => process(item)));',
      '```',
    ].join('\n');
  }
  if (issue.includes('synchronous i/o')) {
    return [
      'Synchronous I/O blocks the whole process — use the async variant:',
      '',
      '```suggestion',
      '// Instead of:',
      'const data = fs.readFileSync(path);',
      '',
      '// Use the async API:',
      'const data = await fs.promises.readFile(path);',
      '```',
    ].join('\n');
  }
  return '';
}

function bestPracticesSuggestion(item) {
  const issue = item.issue.toLowerCase();
  if (issue.includes('direct state mutation')) {
    return [
      'Mutating state directly skips React’s re-render — go through setState:',
      '',
      '```suggestion',
      '// Instead of:',
      'this.state.count = this.state.count + 1;',
      '',
      '// Use setState:',
      'this.setState((prev) => ({ count: prev.count + 1 }));',
      '```',
    ].join('\n');
  }
  if (issue.includes('.map() in jsx without key')) {
    return [
      'Add a stable key so React can track each item across renders:',
      '',
      '```suggestion',
      '// Instead of:',
      'items.map((item) => <Row item={item} />)',
      '',
      '// Add a unique key:',
      'items.map((item) => <Row key={item.id} item={item} />)',
      '```',
    ].join('\n');
  }
  return '';
}

const SUGGESTION_BY_CATEGORY = {
  performance: performanceSuggestion,
  security: securitySuggestion,
  bugs_cat: bugsSuggestion,
  scalability: scalabilitySuggestion,
  best_practices: bestPracticesSuggestion,
};

// Map a file extension to a GitHub-flavored markdown language tag so code
// blocks render syntax-highlighted. Defaults to `js` since most suggestions
// are JavaScript-oriented.
function langFromFilename(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx',
    ts: 'ts', tsx: 'tsx',
    py: 'py', go: 'go', rb: 'rb', java: 'java', rs: 'rust',
    json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml',
    sh: 'bash', zsh: 'bash', html: 'html', css: 'css', sql: 'sql',
    md: 'md', xml: 'xml',
  };
  return map[ext] || 'js';
}

function suggestionFor(categoryKey, item) {
  const fn = SUGGESTION_BY_CATEGORY[categoryKey];
  if (!fn) return '';
  const text = fn(item);
  if (!text) return '';
  // Language-tagged fence (e.g. ```js) for syntax highlighting. This
  // intentionally drops GitHub's ```suggestion apply-button, per product
  // preference for readable, highlighted code.
  const lang = langFromFilename(item.file || '');
  return text.replace(/```suggestion/g, '```' + lang);
}

// The missing-test finding embeds a test skeleton inside its `recommendation`
// (so it stays self-contained). For the PR comment we split that out into a
// proper, language-tagged code block instead of leaving it as a bare blockquote
// (which mangles multi-line code in markdown).
const SUGGESTED_TEST_MARKER = 'Suggested test — alongside ';

function renderRecommendation(item) {
  const rec = item.recommendation;
  if (!rec) return [];
  const idx = rec.indexOf(SUGGESTED_TEST_MARKER);
  if (idx === -1) return [`  > ${rec}`];
  const prose = rec.slice(0, idx).replace(/\s+$/, '');
  const rest = rec.slice(idx + SUGGESTED_TEST_MARKER.length);
  const colon = rest.indexOf(':');
  const fname = colon !== -1 ? rest.slice(0, colon).trim() : '';
  const code = colon !== -1 ? rest.slice(colon + 1).replace(/^\s+/, '') : '';
  const out = [];
  if (prose) out.push(`  > ${prose}`);
  if (fname) out.push(`Suggested test — alongside \`${fname}\`:`);
  if (code) {
    out.push('```' + langFromFilename(fname));
    out.push(code.replace(/\s+$/, ''));
    out.push('```');
  }
  return out;
}

function hasAnyFindings(review) {
  return CATEGORIES.some((cat) => (review[cat.key] || []).length > 0);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractFileFromIssue(issue) {
  const match = issue.match(/\s+in\s+(\S+)$/);
  return match ? match[1] : '';
}

// Strips the "... in <file>" trailing clause a lot of findings carry (both
// AI- and rule-generated) once the file is already shown some other way
// (grouped under its own heading, or named inline) — repeating it reads like
// a report re-stating its own row headers instead of a comment.
function cleanIssueText(item, file) {
  if (!item.issue) return '';
  if (!file) return item.issue.trim();
  return item.issue.replace(new RegExp(`\\s+in\\s+${escapeRegex(file)}$`), '').trim();
}

function verdictLine(recommendation) {
  const prefix = recommendation.verdict === 'APPROVE'
    ? 'Verdict: approve.'
    : recommendation.verdict === 'REJECT'
      ? 'Verdict: changes requested.'
      : 'Verdict: needs another pass.';
  return `${prefix} ${recommendation.reason}.`;
}

// One line up top naming the 1-2 things that actually matter, the way a
// person opens a review comment — not a dimension-by-dimension breakdown of
// every category before you've even seen what's wrong.
function buildOpeningSummary(review, findings, meta) {
  const fileCount = meta.stats.filesChanged;
  const fileWord = fileCount === 1 ? 'file' : 'files';
  const opener = meta.ticketValidated ? 'Checked this against the ticket' : `Went through the ${fileCount} changed ${fileWord}`;

  if (findings.length === 0) {
    return `${opener} — nothing to flag.`;
  }

  const actionable = findings.filter((f) => f.type === 'BUG' || f.type === 'CONCERN');
  if (actionable.length === 0) {
    return `${opener} — nothing blocking, just a few notes below.`;
  }

  const sorted = [...actionable].sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0));
  const top = sorted.slice(0, 2);
  const mentions = top.map((item) => {
    const file = resolveFindingFile(item, review.files);
    const text = cleanIssueText(item, file);
    return file ? `${text} in \`${file}\`` : text;
  });
  const remaining = actionable.length - top.length;

  let summary = actionable.length === 1
    ? `One thing worth fixing: ${mentions[0]}.`
    : `The main things worth fixing: ${mentions.join('; ')}.`;
  if (remaining > 0) summary += ` ${remaining} more note${remaining === 1 ? '' : 's'} below.`;
  return summary;
}

// Groups findings under the file they belong to, ordered the way the diff
// itself is ordered (rather than by category) — closer to how someone
// actually reads through a PR, file by file, than a fixed dimension list.
function groupFindingsByFile(review, findings) {
  const byFile = new Map();
  const unmatched = [];
  for (const item of findings) {
    const file = resolveFindingFile(item, review.files);
    if (!file) {
      unmatched.push(item);
      continue;
    }
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(item);
  }

  const ordered = [];
  const seen = new Set();
  for (const f of review.files || []) {
    if (byFile.has(f.name)) {
      ordered.push([f.name, byFile.get(f.name)]);
      seen.add(f.name);
    }
  }
  for (const [name, items] of byFile) {
    if (!seen.has(name)) ordered.push([name, items]);
  }
  if (unmatched.length) ordered.push([null, unmatched]);
  return ordered;
}

function generateReviewBody(review) {
  const { meta, recommendation } = review;

  if (recommendation.verdict === 'APPROVE' && !hasAnyFindings(review)) {
    const fileCount = meta.stats.filesChanged;
    const opener = meta.ticketValidated ? 'Checked this against the ticket' : `Went through the ${fileCount} changed file${fileCount === 1 ? '' : 's'}`;
    return [
      `**${meta.prTitle}**`,
      '',
      `${opener} — nothing to flag. Approve.`,
      '',
      '_— PrismLens_',
    ].join('\n');
  }

  const all = [];
  for (const cat of CATEGORIES) {
    for (const item of review[cat.key] || []) all.push({ ...item, categoryKey: cat.key });
  }
  const strengths = all.filter((i) => i.type === 'STRENGTH');
  const findings = all.filter((i) => i.type !== 'STRENGTH');

  const lines = [];
  lines.push(`**${meta.prTitle}**`);
  lines.push('');
  lines.push(buildOpeningSummary(review, findings, meta));
  lines.push('');

  for (const [file, items] of groupFindingsByFile(review, findings)) {
    lines.push(file ? `**\`${file}\`**` : '**General**');
    lines.push('');
    for (const item of items) {
      lines.push(`- ${cleanIssueText(item, file)}`);
      for (const rl of renderRecommendation(item)) lines.push(rl);
      const suggestion = suggestionFor(item.categoryKey, item);
      if (suggestion) {
        lines.push('');
        lines.push(suggestion);
        lines.push('');
      }
    }
    lines.push('');
  }

  if (strengths.length) {
    const notes = strengths.map((s) => cleanIssueText(s, resolveFindingFile(s, review.files)));
    lines.push(`Also worth calling out: ${notes.join('; ')}.`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(verdictLine(recommendation));
  lines.push('');
  lines.push('_— PrismLens_');

  return lines.join('\n');
}



