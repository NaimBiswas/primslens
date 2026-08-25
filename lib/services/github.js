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

export const postPRReview = async (prUrl, token, reviewData, event) => {
  const { owner, repo, prNumber } = parsePRUrl(prUrl);

  const body = generateReviewBody(reviewData);

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

// Colored markup for GitHub PR comments. GitHub strips arbitrary text colors,
// so "color" is conveyed via emoji severity/verdict indicators (which always
// render) — clean, dependency-free, and visible in any client.
const SEV_EMOJI = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢', info: 'ℹ️' };
const TYPE_EMOJI = { BUG: '🐞', CONCERN: '⚠️', INFO: 'ℹ️', STRENGTH: '💪' };
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

function sevBadge(sev) {
  if (!sev) return '';
  return `${SEV_EMOJI[sev] || ''} **${sev}**`.trim();
}

function verdictBadge(verdict) {
  if (verdict === 'APPROVE') return '✅ **APPROVE**';
  if (verdict === 'REJECT') return '❌ **CHANGES REQUESTED**';
  return '⚠️ **REVIEW REQUIRED**';
}

function topSeverity(items) {
  let top = null;
  for (const it of items) {
    const r = SEV_RANK[it.severity];
    if (r != null && (top === null || r > SEV_RANK[top])) top = it.severity;
  }
  return top;
}

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

// Builds a short "why this file changed" note by finding the first review
// finding attached to it, so the generated PR description explains each
// change instead of just naming it. Falls back to a generic note by status.
function fileDescription(review, file) {
  for (const cat of CATEGORIES) {
    for (const item of review[cat.key] || []) {
      const itemFile = resolveFindingFile(item, review.files);
      if (!sameFile(itemFile, file.name)) continue;
      const cleanIssue = item.issue
        ? item.issue.replace(new RegExp(`\\s+in\\s+${escapeRegex(itemFile)}$`), '').trim()
        : '';
      const text = cleanIssue || item.recommendation;
      if (text) return text;
    }
  }
  if (file.status === 'added') return 'New file added.';
  if (file.status === 'removed') return 'File removed.';
  if (file.status === 'renamed') return 'File renamed.';
  return 'Modified as part of this change.';
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

function generateDescription(review) {
  const { meta, files } = review;

  let md = `## Description\n\n`;
  md += `${meta.prTitle} touches **${meta.stats.filesChanged}** file(s) (+${meta.stats.additions}/-${meta.stats.deletions}) on \`${meta.branch || '?'}\`.\n\n`;

  md += `## Changes\n\n`;
  for (const f of files || []) {
    md += `- \`${f.name}\` — ${fileDescription(review, f)}\n`;
  }

  const issues = relatedIssues(review);
  md += `\n## Related Issues\n\n`;
  if (issues.length) {
    for (const i of issues) md += `- ${i}\n`;
  } else {
    md += `None detected from the PR title or branch name.\n`;
  }

  const testFiles = testFilesInPR(review);
  const missingTest = testFiles.length === 0 ? missingTestWarning(review) : null;

  md += `\n## Proof of Testing\n\n`;
  if (testFiles.length) {
    md += `This PR includes the following test file(s):\n\n`;
    for (const tf of testFiles) {
      md += `- \`${tf}\`\n`;
      const patch = (files || []).find((f) => f.name === tf)?.patch;
      if (patch) md += '\n```' + langFromFilename(tf) + '\n' + patch.trim() + '\n```\n\n';
    }
  } else if (missingTest) {
    md += `No test files were changed.\n\n${renderTestSuggestionMarkdown(missingTest)}\n`;
  } else {
    md += `No test files were changed in this PR.\n`;
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

function generateReviewBody(review) {
  const { meta, recommendation } = review;

  if (recommendation.verdict === 'APPROVE' && !hasAnyFindings(review)) {
    return [
      `## 🔍 Code Review: ${meta.prTitle}`,
      ``,
      `✅ **All checks passed — no issues found.**`,
      ``,
      `_Reviewed by PrismLens_`,
    ].join('\n');
  }

  const lines = [];
  lines.push(`## 🔍 Code Review: ${meta.prTitle}`);
  lines.push('');
  lines.push(`**Author:** @${meta.prAuthor || 'unknown'} · **Files changed:** ${meta.stats.filesChanged} (+${meta.stats.additions}/-${meta.stats.deletions})`);
  lines.push('');
  lines.push(`**Verdict:** ${verdictBadge(recommendation.verdict)}`);
  lines.push('');

  // Overview table — at-a-glance counts per dimension
  lines.push('### 📊 Overview');
  lines.push('');
  lines.push('| Dimension | 🐞 Bugs | ⚠️ Concerns | ℹ️ Info | 💪 Strengths |');
  lines.push('| --- | :---: | :---: | :---: | :---: |');
  for (const cat of CATEGORIES) {
    const items = review[cat.key] || [];
    if (!items.length) continue;
    const bugs = items.filter((i) => i.type === 'BUG').length;
    const concerns = items.filter((i) => i.type === 'CONCERN').length;
    const infos = items.filter((i) => i.type === 'INFO').length;
    const strengths = items.filter((i) => i.type === 'STRENGTH').length;
    lines.push(`| ${cat.label} | ${bugs || ''} | ${concerns || ''} | ${infos || ''} | ${strengths || ''} |`);
  }
  lines.push('');

  // Detailed findings per dimension, color-coded by highest severity
  let hasDetail = false;
  for (const cat of CATEGORIES) {
    const items = review[cat.key] || [];
    if (!items.length) continue;
    hasDetail = true;
    const top = topSeverity(items);
    const headerEmoji = top ? `${SEV_EMOJI[top] || ''} ` : '';
    lines.push(`### ${headerEmoji}${cat.label}`);
    lines.push('');
    for (const item of items) {
      const typeLabel = `${TYPE_EMOJI[item.type] || ''} ${item.type.charAt(0) + item.type.slice(1).toLowerCase()}`.trim();
      const file = item.file || extractFileFromIssue(item.issue);
      const cleanIssue = file ? item.issue.replace(new RegExp(`\\s+in\\s+${escapeRegex(file)}$`), '') : item.issue;
      lines.push(`- **${typeLabel}** ${sevBadge(item.severity)} — ${cleanIssue}`);
      if (file) lines.push(`  \`${file}\``);
      for (const rl of renderRecommendation(item)) lines.push(rl);
      const suggestion = suggestionFor(cat.key, item);
      if (suggestion) {
        lines.push('');
        lines.push(suggestion);
        lines.push('');
      }
    }
    lines.push('');
  }

  if (!hasDetail) lines.push('_No specific findings._\n');

  lines.push('---');
  lines.push('');
  lines.push('### 💬 Verdict');
  lines.push('');
  lines.push(`**${recommendation.label}**`);
  lines.push('');
  lines.push(`${recommendation.reason}`);
  lines.push('');
  lines.push('_Reviewed by PrismLens_');

  return lines.join('\n');
}



