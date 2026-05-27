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

export const mergePR = async (prUrl, token, mergeMethod = 'merge') => {
  const { owner, repo, prNumber } = parsePRUrl(prUrl);
  const res = await axios.put(
    `${GITHUB_BASE_URL}/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
    { merge_method: mergeMethod },
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

function hasAnyFindings(review) {
  return CATEGORIES.some((cat) => (review[cat.key] || []).length > 0);
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
      if (cat.key === 'performance') {
        const suggestion = performanceSuggestion(item);
        if (suggestion) {
          md += `\n${suggestion}\n`;
        }
      }
    }
  }

  if (!hasDetail) md += `\n_No specific findings._\n`;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractFileFromIssue(issue) {
  const match = issue.match(/\s+in\s+(\S+)$/);
  return match ? match[1] : '';
}

  md += `\n---\n`;
  md += `### Comment\n\n`;
  md += `**${recommendation.label}**\n\n`;
  md += `${recommendation.reason}  \n`;
  md += `\n_Reviewed by PrismLens_\n`;

  return md;
}
