import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelsOutput } from '../lib/services/models.js';

// Shape mirrors real `opencode models opencode --verbose` output.
const SAMPLE = `opencode/hy3-free
{
  "id": "hy3-free",
  "providerID": "opencode",
  "name": "Hy3 Free",
  "cost": { "input": 0, "output": 0 },
  "limit": { "context": 190000, "output": 64000 }
}
opencode/paid-example
{
  "id": "paid-example",
  "providerID": "opencode",
  "name": "Paid Example",
  "cost": { "input": 3, "output": 15 },
  "limit": { "context": 128000 }
}
`;

test('parseModelsOutput extracts every model block', () => {
  const blocks = parseModelsOutput(SAMPLE);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].id, 'hy3-free');
  assert.equal(blocks[0].name, 'Hy3 Free');
  assert.equal(blocks[1].id, 'paid-example');
});

test('parseModelsOutput preserves cost so callers can filter free models', () => {
  const blocks = parseModelsOutput(SAMPLE);
  assert.equal(blocks[0].cost.input, 0);
  assert.equal(blocks[0].cost.output, 0);
  assert.equal(blocks[1].cost.input, 3);
});

test('parseModelsOutput ignores ANSI escape codes in the raw output', () => {
  const withAnsi = `\x1b[32mopencode/hy3-free\x1b[0m\n{\n  "id": "hy3-free",\n  "providerID": "opencode",\n  "name": "Hy3 Free",\n  "cost": { "input": 0, "output": 0 }\n}\n`;
  const blocks = parseModelsOutput(withAnsi);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].name, 'Hy3 Free');
});

test('parseModelsOutput returns an empty array for empty input', () => {
  assert.deepEqual(parseModelsOutput(''), []);
});
