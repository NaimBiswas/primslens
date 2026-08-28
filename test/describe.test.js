import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDescription } from '../lib/services/github.js';

function makeReview(overrides = {}) {
  return {
    meta: { prTitle: 'Test PR', stats: { filesChanged: 1, additions: 1, deletions: 0 }, branch: 'feature' },
    files: [],
    performance: [], security: [], readability: [], bugs_cat: [], scalability: [], best_practices: [],
    recommendation: { verdict: 'APPROVE', label: 'Approve', reason: 'No critical issues found. Ready to merge' },
    ...overrides,
  };
}

test('opens with a PR Title section carrying the PR title', () => {
  const review = makeReview({
    meta: { prTitle: 'P5-12470: CI Node 24 runtime bump', stats: { filesChanged: 1, additions: 1, deletions: 0 }, branch: 'ci/bump' },
  });
  const md = generateDescription(review);
  assert.match(md, /^## PR Title\n\nP5-12470: CI Node 24 runtime bump/);
});

test('bases the Description section on the pasted ticket when the review was ticket-scoped', () => {
  const review = makeReview({
    meta: {
      prTitle: 'P5-12470: CI Node 24 runtime bump',
      stats: { filesChanged: 1, additions: 1, deletions: 0 },
      branch: 'ci/bump',
      ticketDescription: 'CI-side portion of Phase 1 for the Angular 20 upgrade (parent: P5-12341).',
    },
  });
  const md = generateDescription(review);
  assert.match(md, /## Description\n\nCI-side portion of Phase 1 for the Angular 20 upgrade \(parent: P5-12341\)\.\n\nTouches/);
});

test('falls back to the diff-stats description when no ticket was pasted', () => {
  const review = makeReview();
  const md = generateDescription(review);
  assert.match(md, /## Description\n\nTouches \*\*1\*\* file\(s\)/);
});

test('condenses a long pasted ticket down to a few leading sentences instead of dumping it verbatim', () => {
  const sentences = Array.from({ length: 10 }, (_, i) => `Sentence number ${i + 1} of the ticket.`);
  const review = makeReview({
    meta: {
      prTitle: 'Long ticket PR',
      stats: { filesChanged: 1, additions: 1, deletions: 0 },
      branch: 'feature',
      ticketDescription: sentences.join(' '),
    },
  });
  const md = generateDescription(review);
  assert.ok(md.includes('Sentence number 1 of the ticket.'));
  assert.ok(md.includes('Sentence number 4 of the ticket.'));
  assert.ok(!md.includes('Sentence number 5 of the ticket.'));
});

test('per-file Changes note quotes the actual added line as the "why", not a generic label', () => {
  const review = makeReview({
    files: [{ name: '.nvmrc', status: 'added', additions: 1, deletions: 0, patch: '@@ -0,0 +1 @@\n+24.7.0' }],
  });
  const md = generateDescription(review);
  assert.match(md, /`\.nvmrc` \(\+1\/-0\) — New file — adds `24\.7\.0`\./);
});

test('groups changed files under CI/Build/Tests/Source subsections', () => {
  const review = makeReview({
    meta: { prTitle: 'CI bump', stats: { filesChanged: 2, additions: 10, deletions: 2 }, branch: 'ci/bump' },
    files: [
      { name: '.github/workflows/ci.yml', status: 'modified', additions: 8, deletions: 2 },
      { name: '.nvmrc', status: 'added', additions: 1, deletions: 0 },
    ],
  });
  const md = generateDescription(review);
  assert.match(md, /## Changes/);
  assert.match(md, /### CI \/ Workflows/);
  assert.match(md, /### Build & Dependencies/);
  assert.ok(md.indexOf('CI / Workflows') < md.indexOf('Build & Dependencies'));
});

test('flags a config-only PR (no source files touched)', () => {
  const review = makeReview({
    files: [{ name: 'package.json', status: 'modified', additions: 1, deletions: 1 }],
  });
  const md = generateDescription(review);
  assert.match(md, /Configuration\/tooling only/);
});

test('does not flag a PR that touches source files as config-only', () => {
  const review = makeReview({
    files: [{ name: 'src/app.js', status: 'modified', additions: 1, deletions: 1 }],
  });
  const md = generateDescription(review);
  assert.ok(!/Configuration\/tooling only/.test(md));
});

test('Changes section is purely factual — no review findings, severities, or bug/concern language', () => {
  const review = makeReview({
    files: [{ name: 'src/app.js', status: 'modified', additions: 5, deletions: 1 }],
    security: [{ type: 'BUG', severity: 'critical', category: 'security', file: 'src/app.js', issue: 'eval() usage in src/app.js', recommendation: 'Remove eval' }],
  });
  const md = generateDescription(review);
  assert.match(md, /`src\/app\.js` \(\+5\/-1\) — Modified as part of this change\./);
  assert.ok(!/eval\(\) usage/.test(md));
  assert.ok(!/critical/.test(md));
  assert.ok(!/⚠/.test(md));
});

test('omits the Verification section entirely when there is nothing concrete to report', () => {
  const review = makeReview({
    files: [{ name: 'src/app.js', status: 'modified', additions: 1, deletions: 0 }],
  });
  const md = generateDescription(review);
  assert.ok(!/## Verification/.test(md));
  assert.ok(!/PrismLens automated review/.test(md));
  assert.ok(!/No test files were changed/.test(md));
});

test('Verification section lists test files actually touched', () => {
  const review = makeReview({
    files: [{ name: 'src/app.test.js', status: 'added', additions: 5, deletions: 0, patch: '+test("x", () => {});' }],
  });
  const md = generateDescription(review);
  assert.match(md, /## Verification/);
  assert.match(md, /Test file\(s\) touched: `src\/app\.test\.js`/);
});

test('Verification section surfaces the missing-test suggestion when one exists', () => {
  const review = makeReview({
    files: [{ name: 'src/app.js', status: 'modified', additions: 20, deletions: 0 }],
    best_practices: [{
      type: 'CONCERN', severity: 'medium', category: 'best-practices',
      issue: '20 line(s) of new code added across 1 file(s) with no accompanying test file',
      recommendation: 'Add or update tests covering the new behavior before merging',
    }],
  });
  const md = generateDescription(review);
  assert.match(md, /## Verification/);
  assert.match(md, /Add or update tests/);
});

test('lists related issue references pulled from the PR title', () => {
  const review = makeReview({
    meta: { prTitle: 'Fixes #42: handle empty input', stats: { filesChanged: 1, additions: 1, deletions: 0 }, branch: 'fix/42' },
    files: [{ name: 'src/app.js', status: 'modified', additions: 1, deletions: 0 }],
  });
  const md = generateDescription(review);
  assert.match(md, /\(refs: #42\)/);
});
