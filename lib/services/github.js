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

function generateDescription(review) {
  const { meta, recommendation, files } = review;

  let md = `## Summary\n\n`;
  md += `${meta.prTitle} touches **${meta.stats.filesChanged}** file(s) (+${meta.stats.additions}/-${meta.stats.deletions}) on \`${meta.branch || '?'}\`.\n\n`;

  md += `## Changes\n\n`;
  for (const f of files || []) {
    const verb = f.status === 'added' ? 'Add' : f.status === 'removed' ? 'Remove' : f.status === 'renamed' ? 'Rename' : 'Update';
    md += `- **${verb}** \`${f.name}\` (+${f.additions}/-${f.deletions})\n`;
  }

  md += `\n## Review Snapshot\n\n`;
  for (const cat of CATEGORIES) {
    const items = review[cat.key] || [];
    if (!items.length) continue;
    md += `- **${cat.label}** — ${items.length} finding(s)\n`;
  }
  if (CATEGORIES.every((cat) => !(review[cat.key] || []).length)) {
    md += `- No findings across any dimension.\n`;
  }
  md += `- **Verdict** — ${recommendation.label}\n`;

  md += `\n---\n_Description generated by PrismLens_\n`;
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

function suggestionFor(categoryKey, item) {
  const fn = SUGGESTION_BY_CATEGORY[categoryKey];
  return fn ? fn(item) : '';
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
    let md = `## Code Review: ${meta.prTitle}\n\n`;
    md += `All looks good. No issues found.  \n`;
    md += `\n_Reviewed by PrismLens_\n`;
    return md;
  }

  let md = `## Code Review: ${meta.prTitle}\n\n`;
  md += `**Author:** ${meta.prAuthor}  \n`;
  md += `**Files changed:** ${meta.stats.filesChanged} (+${meta.stats.additions}/-${meta.stats.deletions})  \n\n`;

  md += `### Overview\n\n`;
  for (const cat of CATEGORIES) {
    const items = review[cat.key] || [];
    if (!items.length) continue;
    const bugs = items.filter((i) => i.type === 'BUG').length;
    const concerns = items.filter((i) => i.type === 'CONCERN').length;
    const strengths = items.filter((i) => i.type === 'STRENGTH').length;
    const infos = items.filter((i) => i.type === 'INFO').length;
    const parts = [];
    if (bugs) parts.push(`${bugs} bug(s)`);
    if (concerns) parts.push(`${concerns} concern(s)`);
    if (infos) parts.push(`${infos} info`);
    if (strengths) parts.push(`${strengths} strength(s)`);
    md += `- **${cat.label}** \u2014 ${parts.join(', ') || 'no findings'}\n`;
  }

  const verdictLine = recommendation.verdict === 'APPROVE' ? 'Approve' : recommendation.verdict === 'REJECT' ? 'Changes requested' : 'Review required';
  const totalBugs = (review.bugs || []).length;
  const totalConcerns = (review.concerns || []).length;
  md += `- **Verdict** \u2014 ${verdictLine}\n`;

  let hasDetail = false;
  for (const cat of CATEGORIES) {
    const items = review[cat.key] || [];
    if (!items.length) continue;
    hasDetail = true;
    md += `\n### ${cat.label}\n\n`;
    for (const item of items) {
      const sev = item.severity ? `${item.severity} ` : '';
      const typeLabel = item.type.charAt(0) + item.type.slice(1).toLowerCase();
      const file = item.file || extractFileFromIssue(item.issue);
      const cleanIssue = file ? item.issue.replace(new RegExp(`\\s+in\\s+${escapeRegex(file)}$`), '') : item.issue;
      md += `- **${typeLabel}** ${sev}\u2014 ${cleanIssue}\n`;
      if (file) md += `  \`${file}\`\n`;
      if (item.recommendation) {
        md += `  > ${item.recommendation}\n`;
      }
      const suggestion = suggestionFor(cat.key, item);
      if (suggestion) {
        md += `\n${suggestion}\n`;
      }
    }
  }

  if (!hasDetail) md += `\n_No specific findings._\n`;

  md += `\n---\n`;
  md += `### Comment\n\n`;
  md += `**${recommendation.label}**\n\n`;
  md += `${recommendation.reason}  \n`;
  md += `\n_Reviewed by PrismLens_\n`;

  return md;
}
