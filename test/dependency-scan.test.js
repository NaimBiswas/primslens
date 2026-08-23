import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripVersionPrefix, severityFromOsv, fixedVersionFrom } from '../lib/services/dependency-scan.js';

test('stripVersionPrefix removes ^/~/range operators', () => {
  assert.equal(stripVersionPrefix('^1.16.1'), '1.16.1');
  assert.equal(stripVersionPrefix('~2.3.4'), '2.3.4');
  assert.equal(stripVersionPrefix('>=1.0.0'), '1.0.0');
  assert.equal(stripVersionPrefix('1.2.3'), '1.2.3');
});

test('stripVersionPrefix returns null for non-semver specs (workspace:, git urls, tags)', () => {
  assert.equal(stripVersionPrefix('workspace:*'), null);
  assert.equal(stripVersionPrefix('latest'), null);
  assert.equal(stripVersionPrefix('git+https://github.com/o/r.git'), null);
});

test('severityFromOsv maps database_specific.severity to PrismLens severities', () => {
  assert.equal(severityFromOsv({ database_specific: { severity: 'CRITICAL' } }), 'critical');
  assert.equal(severityFromOsv({ database_specific: { severity: 'HIGH' } }), 'high');
  assert.equal(severityFromOsv({ database_specific: { severity: 'MODERATE' } }), 'medium');
  assert.equal(severityFromOsv({ database_specific: { severity: 'LOW' } }), 'low');
  assert.equal(severityFromOsv({}), 'medium');
});

test('fixedVersionFrom finds the first "fixed" event across affected ranges', () => {
  const vuln = {
    affected: [{ ranges: [{ type: 'SEMVER', events: [{ introduced: '0.1.0' }, { fixed: '1.2.3' }] }] }],
  };
  assert.equal(fixedVersionFrom(vuln), '1.2.3');
});

test('fixedVersionFrom returns null when no fix is published yet', () => {
  const vuln = { affected: [{ ranges: [{ type: 'SEMVER', events: [{ introduced: '0.1.0' }] }] }] };
  assert.equal(fixedVersionFrom(vuln), null);
});
