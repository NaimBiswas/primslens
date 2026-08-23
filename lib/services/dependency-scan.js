import { fetchFileContent } from './github.js';

const OSV_QUERY_URL = 'https://api.osv.dev/v1/query';
const MAX_DEPENDENCIES = 40; // keep scan time bounded on very large manifests
const OSV_TIMEOUT_MS = 8000;

export function stripVersionPrefix(spec) {
  const cleaned = (spec || '').trim().replace(/^[~^><=\s]+/, '').split(/[\s|]/)[0];
  return cleaned && /^\d/.test(cleaned) ? cleaned : null;
}

export function severityFromOsv(vuln) {
  const s = (vuln.database_specific?.severity || '').toUpperCase();
  if (s === 'CRITICAL') return 'critical';
  if (s === 'HIGH') return 'high';
  if (s === 'LOW') return 'low';
  return 'medium'; // MODERATE, or unlabeled
}

export function fixedVersionFrom(vuln) {
  for (const affected of vuln.affected || []) {
    for (const range of affected.ranges || []) {
      const fixed = range.events?.find((e) => e.fixed)?.fixed;
      if (fixed) return fixed;
    }
  }
  return null;
}

async function queryOsv(name, version) {
  try {
    const res = await fetch(OSV_QUERY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: { name, ecosystem: 'npm' }, version }),
      signal: AbortSignal.timeout(OSV_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.vulns || [];
  } catch {
    return []; // OSV being unreachable should never break a review
  }
}

/**
 * Scans package.json's dependencies + devDependencies against OSV.dev's
 * free public vulnerability database, if the PR touched package.json.
 * npm/JS only for now — other ecosystems (pip, go.mod, ...) aren't wired
 * up yet. Findings land in the `security` category alongside everything
 * else, `file: 'package.json'`.
 */
export async function scanDependencies(prUrl, token, files) {
  const touchesPackageJson = (files || []).some((f) => f.filename === 'package.json');
  if (!touchesPackageJson) return [];

  let pkg;
  try {
    const { content } = await fetchFileContent(prUrl, token, 'package.json');
    pkg = JSON.parse(content);
  } catch {
    return [];
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const entries = Object.entries(deps).slice(0, MAX_DEPENDENCIES);

  const perDependency = await Promise.all(entries.map(async ([name, spec]) => {
    const version = stripVersionPrefix(spec);
    if (!version) return [];
    const vulns = await queryOsv(name, version);
    return vulns.map((v) => {
      const fixed = fixedVersionFrom(v);
      return {
        type: 'BUG',
        severity: severityFromOsv(v),
        category: 'security',
        issue: `${name}@${version} has a known vulnerability (${v.id}) — ${v.summary || 'see advisory for details'}`,
        recommendation: fixed ? `Upgrade ${name} to >=${fixed}` : `Review ${v.id} for remediation guidance`,
        file: 'package.json',
      };
    });
  }));

  return perDependency.flat();
}
