import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testSkeletonFor } from '../lib/services/test-skeleton.js';

test('testSkeletonFor produces a describe/it skeleton for JS/TS files', () => {
  const skeleton = testSkeletonFor('src/lib/rate-limit.ts');
  assert.ok(skeleton.includes("describe('rate-limit'"));
  assert.ok(skeleton.includes('it('));
});

test('testSkeletonFor produces a pytest skeleton for .py files', () => {
  const skeleton = testSkeletonFor('app/utils/parser.py');
  assert.ok(skeleton.includes('def test_parser_typical_input():'));
});

test('testSkeletonFor produces a Go testing skeleton for .go files', () => {
  const skeleton = testSkeletonFor('internal/cache/cache.go');
  assert.ok(skeleton.includes('func TestCache(t *testing.T)'));
});

test('testSkeletonFor returns empty string for an unrecognized extension', () => {
  assert.equal(testSkeletonFor('config/settings.yaml'), '');
});
