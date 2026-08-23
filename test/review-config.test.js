import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, isIgnored, applyReviewConfig } from '../lib/services/review-config.js';
import { analyzeFallback } from '../lib/services/analyzer.js';

function makePrData() {
  return {
    title: 'Test PR',
    user: { login: 'tester' },
    html_url: 'https://github.com/o/r/pull/1',
    number: 1,
    head: { repo: { owner: { login: 'o' }, name: 'r' }, ref: 'feature' },
    base: { repo: { owner: { login: 'o' }, name: 'r' } },
  };
}

function makeFile(filename, patchLines) {
  return { filename, status: 'modified', additions: patchLines.length, deletions: 0, patch: patchLines.join('\n') };
}

test('globToRegExp: single * does not cross a path separator', () => {
  const re = globToRegExp('src/*.js');
  assert.equal(re.test('src/a.js'), true);
  assert.equal(re.test('src/nested/a.js'), false);
});

test('globToRegExp: ** matches across path separators', () => {
  const re = globToRegExp('dist/**');
  assert.equal(re.test('dist/a.js'), true);
  assert.equal(re.test('dist/nested/deep/a.js'), true);
});

test('isIgnored matches any glob in the list', () => {
  assert.equal(isIgnored('dist/bundle.js', ['dist/**']), true);
  assert.equal(isIgnored('src/index.js', ['dist/**']), false);
});

test('applyReviewConfig removes findings in disabledChecks categories', () => {
  const findings = [
    { category: 'security', severity: 'high', issue: 'a' },
    { category: 'readability', severity: 'low', issue: 'b' },
  ];
  const out = applyReviewConfig(findings, { disabledChecks: ['readability'] });
  assert.equal(out.length, 1);
  assert.equal(out[0].category, 'security');
});

test('applyReviewConfig remaps severity per category override', () => {
  const findings = [{ category: 'readability', severity: 'medium', issue: 'a' }];
  const out = applyReviewConfig(findings, { severityOverrides: { readability: 'low' } });
  assert.equal(out[0].severity, 'low');
});

test('analyzeFallback skips files matched by config.ignorePaths', () => {
  const file = makeFile('vendor/lib.js', ['+eval(userInput);']);
  const result = analyzeFallback(makePrData(), [file], { ignorePaths: ['vendor/**'] });
  assert.equal(result.reviews.length, 0);
  // The file still shows up in the changed-files list even though it wasn't analyzed.
  assert.equal(result.files.length, 1);
});

test('analyzeFallback applies severityOverrides end to end', () => {
  const file = makeFile('src/a.js', ["+if (a == b) {}"]);
  const result = analyzeFallback(makePrData(), [file], { severityOverrides: { bugs: 'low' } });
  const bugFinding = result.bugs_cat.find((f) => /loose equality/i.test(f.issue));
  assert.ok(bugFinding);
  assert.equal(bugFinding.severity, 'low');
});
