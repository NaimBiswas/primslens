function baseName(filename) {
  return filename.split('/').pop().replace(/\.[^.]+$/, '');
}

function extOf(filename) {
  const match = filename.match(/\.([^./]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const JS_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']);

/**
 * Best-effort, framework-agnostic test skeleton for a source file, keyed by
 * extension. Not a real generated test (no AST, no knowledge of actual
 * exports) — a concrete starting point so "add tests" isn't the whole
 * recommendation. Returns '' for extensions with no known convention.
 */
export function testSkeletonFor(filename) {
  const base = baseName(filename);
  const ext = extOf(filename);

  if (JS_EXTS.has(ext)) {
    return [
      `import { describe, it, expect } from 'vitest'; // or jest, or node:test`,
      `import { /* the function(s) you added */ } from './${base}';`,
      '',
      `describe('${base}', () => {`,
      `  it('handles the new behavior added in this change', () => {`,
      '    // arrange input, call the function, assert the result',
      '  });',
      '',
      "  it('covers the edge case this change introduces', () => {",
      '    // e.g. empty input, error path, boundary value',
      '  });',
      '});',
    ].join('\n');
  }

  if (ext === 'py') {
    return [
      `def test_${base}_typical_input():`,
      '    # arrange, call, assert',
      '    pass',
      '',
      `def test_${base}_edge_case():`,
      '    # cover the edge case this change introduces',
      '    pass',
    ].join('\n');
  }

  if (ext === 'go') {
    return [
      `func Test${capitalize(base)}(t *testing.T) {`,
      '    // arrange, call, assert (t.Errorf on mismatch)',
      '}',
    ].join('\n');
  }

  if (ext === 'rb') {
    return [
      `RSpec.describe '${base}' do`,
      "  it 'handles the new behavior added in this change' do",
      '    # arrange, call, assert',
      '  end',
      'end',
    ].join('\n');
  }

  if (ext === 'java') {
    return [
      '@Test',
      `void ${base}HandlesNewBehavior() {`,
      '    // arrange, call, assert',
      '}',
    ].join('\n');
  }

  if (ext === 'rs') {
    return [
      '#[test]',
      `fn ${base}_handles_new_behavior() {`,
      '    // arrange, call, assert',
      '}',
    ].join('\n');
  }

  return '';
}
