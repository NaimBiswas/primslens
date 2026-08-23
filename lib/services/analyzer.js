import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { findOpenCode, stripAnsi } from './shared.js';
import { getSelectedModel } from './model-config.js';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const PROJECT_ROOT = join(__dirname, '..', '..');
const CONTEXT_FILE = join(PROJECT_ROOT, '.prismlens-review-context.json');

function extractJSON(text) {
  const cleaned = stripAnsi(text).trim();
  const fenceRegex = /```(?:json)?\s*\n?([\s\S]*?)```/;
  const fenceMatch = cleaned.match(fenceRegex);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* fall through */ }
  }
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    try { return JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)); } catch { /* give up */ }
  }
  return null;
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

function buildResult(prData, files, allReviews, analysisMode) {
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

async function analyzeWithOpenCode(prData, files, opencodePath) {
  const context = {
    prTitle: prData.title,
    files: files.map((f) => ({
      filename: f.filename,
      patch: (f.patch || '').slice(0, 10000),
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
  };

  await writeFile(CONTEXT_FILE, JSON.stringify(context, null, 2), 'utf-8');

  try {
    const stdout = await new Promise((resolve, reject) => {
      const model = getSelectedModel();
      const args = ['run', '--agent', 'prismlens-review'];
      if (model) args.push('-m', model);
      args.push(
        '--dangerously-skip-permissions',
        '--log-level', 'ERROR',
        `You MUST return ONLY raw JSON. Read .prismlens-review-context.json and analyze ${context.files.length} file(s). Output: {"findings":[...]}`,
      );
      const child = spawn(opencodePath, args, { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

      let out = '';
      let errOut = '';
      child.stdout.on('data', (c) => { out += c.toString(); });
      child.stderr.on('data', (c) => { errOut += c.toString(); });

      const timer = setTimeout(() => { child.kill(); reject(new Error('Timed out after 180s')); }, 180000);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 || (code === null && out.length > 0)) resolve(out);
        else reject(new Error(errOut ? stripAnsi(errOut).trim().slice(0, 200) : `exit code ${code}`));
      });
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
    });

    const parsed = extractJSON(stdout);
    if (!parsed || !Array.isArray(parsed.findings)) {
      throw new Error('Invalid JSON response from opencode');
    }

    const allReviews = parsed.findings.map((f) => ({ ...f, file: f.filename || '' }));
    return buildResult(prData, files, allReviews, 'ai');
  } finally {
    try { await unlink(CONTEXT_FILE); } catch {}
  }
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
  const looseEq = added.filter((l) => /==[^=]/.test(l) && !/\/\//.test(l) && !/['"]/.test(l));
  if (looseEq.length > 0) findings.push({ type: 'CONCERN', severity: 'medium', category: 'bugs', issue: `${looseEq.length} loose equality (==) usage${looseEq.length > 1 ? 's' : ''} in ${name}`, recommendation: 'Use === to avoid type-coercion bugs' });
  const nullAccess = added.filter((l) => /\w+\.\w+\.\w+/.test(l) && !/\?\./.test(l) && /[=return(]/.test(l) && !/['"`]/.test(l));
  if (nullAccess.length > 3) findings.push({ type: 'CONCERN', severity: 'medium', category: 'bugs', issue: `Chained property access without optional chaining in ${name} (${nullAccess.length} occurrences)`, recommendation: 'Use optional chaining (?.) to prevent Cannot read property of undefined' });
  const unhandledPromise = added.filter((l) => /\.then\s*\(/.test(l) && !/\.catch\s*\(/.test(l));
  if (unhandledPromise.length > 0) findings.push({ type: 'BUG', severity: 'high', category: 'bugs', issue: `${unhandledPromise.length} .then() without .catch() in ${name} — unhandled rejection`, recommendation: 'Add .catch() or use async/await with try-catch' });
  const nanComparison = added.some((l) => /===?\s*NaN/.test(l) || /NaN\s*===?/.test(l));
  if (nanComparison) findings.push({ type: 'BUG', severity: 'high', category: 'bugs', issue: `NaN comparison in ${name} — NaN !== NaN, use isNaN() instead`, recommendation: 'Use Number.isNaN() to check for NaN values' });
  return findings;
}

function checkScalability(file, added) {
  const findings = [];
  const name = file.filename;
  const asyncForEach = added.filter((l) => /forEach\s*\(/.test(l) && /async/.test(l));
  if (asyncForEach.length > 0) findings.push({ type: 'BUG', severity: 'high', category: 'scalability', issue: `async forEach in ${name} — N+1 issue, Promises fire concurrently without control`, recommendation: 'Use for...of with async/await or Promise.all() for controlled parallelism' });
  const syncIO = added.filter((l) => /(readFileSync|writeFileSync|existsSync|mkdirSync|readdirSync)/.test(l));
  if (syncIO.length > 0) findings.push({ type: 'CONCERN', severity: 'high', category: 'scalability', issue: `Synchronous I/O in ${name} (${syncIO.length} call(s)) — blocks the entire process`, recommendation: 'Use async I/O methods for non-blocking operation' });
  if (added.some((l) => /\.(sort|filter|map|reduce)\s*\(/.test(l) && /(all|every|list|items|data|records|rows)/i.test(l))) findings.push({ type: 'INFO', severity: 'medium', category: 'scalability', issue: `In-memory array operations on potentially large dataset in ${name}`, recommendation: 'Consider database-level pagination and server-side filtering' });
  const hardcodedLimits = added.filter((l) => /\.limit\s*\(/.test(l) || /pageSize\s*=\s*\d{2,4}/.test(l) || /timeout\s*=\s*\d{2,6}/.test(l));
  if (hardcodedLimits.length > 0) findings.push({ type: 'INFO', severity: 'low', category: 'scalability', issue: `Hardcoded limits/timeouts in ${name} — may not suit all environments`, recommendation: 'Make limits configurable via environment variables' });
  if (added.some((l) => /(addEventListener|on\s*\()/.test(l)) && !added.some((r) => /removeEventListener|off\s*\(/.test(r))) findings.push({ type: 'INFO', severity: 'medium', category: 'scalability', issue: `Event listener(s) added in ${name} without cleanup — risk of memory leaks`, recommendation: 'Always remove event listeners on unmount/dispose' });
  return findings;
}

function checkBestPractices(file, added) {
  const findings = [];
  const name = file.filename;
  const todos = added.filter((l) => /\/\/\s*(TODO|FIXME|HACK|XXX|WORKAROUND)/i.test(l));
  if (todos.length > 0) findings.push({ type: 'CONCERN', severity: 'low', category: 'best-practices', issue: `${todos.length} TODO/FIXME/HACK comment(s) in ${name}`, recommendation: 'Address technical debt before merging' });
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

function analyzeFallback(prData, files) {
  const allReviews = files.flatMap(analyzeFileFallback);
  return buildResult(prData, files, allReviews, 'fallback');
}

// ─── Main export ─────────────────────────────────────────────────────────

export { analyzeFallback };

export async function analyzePR(prData, files) {
  const opencodePath = await findOpenCode();
  if (opencodePath) {
    try {
      const result = await analyzeWithOpenCode(prData, files, opencodePath);
      return result;
    } catch (err) {
      console.warn('OpenCode analysis failed, using fallback:', err.message);
    }
  }
  return analyzeFallback(prData, files);
}
