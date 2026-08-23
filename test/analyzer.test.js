import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFallback } from '../server/services/analyzer.js';

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
  return {
    filename,
    status: 'modified',
    additions: patchLines.length,
    deletions: 0,
    patch: patchLines.join('\n'),
  };
}

test('flags nested loops as a performance concern', () => {
  const file = makeFile('src/process.js', [
    '+function process(listA, listB) {',
    '+  for (const a of listA) {',
    '+    for (const b of listB) {',
    '+      if (a.id === b.ref) {}',
    '+    }',
    '+  }',
    '+}',
  ]);
  const result = analyzeFallback(makePrData(), [file]);
  assert.ok(result.performance.some((f) => /nested loop/i.test(f.issue)));
});

test('flags eval() and hardcoded credentials as security bugs', () => {
  const file = makeFile('src/auth.js', [
    '+eval(userInput);',
    '+const apiKey = "abcdefghij1234567890";',
  ]);
  const result = analyzeFallback(makePrData(), [file]);
  assert.ok(result.security.some((f) => /eval/i.test(f.issue)));
  assert.ok(result.security.some((f) => /credential/i.test(f.issue)));
  assert.equal(result.recommendation.verdict, 'REJECT');
});

test('flags loose equality and unhandled promises as bugs', () => {
  const file = makeFile('src/util.js', [
    '+if (a == b) { doSomething(); }',
    '+fetchData().then(function (x) { console.log(x); });',
  ]);
  const result = analyzeFallback(makePrData(), [file]);
  assert.ok(result.bugs_cat.some((f) => /loose equality/i.test(f.issue)));
  assert.ok(result.bugs_cat.some((f) => /unhandled rejection/i.test(f.issue)));
});

test('flags long lines as a readability concern', () => {
  const longLine = `+const x = "${'a'.repeat(130)}";`;
  const file = makeFile('src/long.js', [longLine, longLine.replace('x', 'y'), longLine.replace('x', 'z')]);
  const result = analyzeFallback(makePrData(), [file]);
  assert.ok(result.readability.some((f) => /exceed 120/i.test(f.issue)));
});

test('flags synchronous I/O as a scalability concern', () => {
  const file = makeFile('src/io.js', ["+const data = readFileSync('file.txt');"]);
  const result = analyzeFallback(makePrData(), [file]);
  assert.ok(result.scalability.some((f) => /synchronous i\/o/i.test(f.issue)));
});

test('flags TODO comments as a best-practices concern', () => {
  const file = makeFile('src/todo.js', ['+// TODO: refactor this later']);
  const result = analyzeFallback(makePrData(), [file]);
  assert.ok(result.best_practices.some((f) => /TODO/i.test(f.issue)));
});

test('clean diffs produce no findings and an APPROVE verdict', () => {
  const file = makeFile('src/clean.js', ["+const greeting = 'hello';"]);
  const result = analyzeFallback(makePrData(), [file]);
  assert.equal(result.reviews.length, 0);
  assert.equal(result.recommendation.verdict, 'APPROVE');
});

test('tags results with the fallback analysis mode', () => {
  const file = makeFile('src/clean.js', ["+const greeting = 'hello';"]);
  const result = analyzeFallback(makePrData(), [file]);
  assert.equal(result.meta.analysisMode, 'fallback');
});
