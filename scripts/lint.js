// Minimal, dependency-free linter: recursively syntax-checks every .js file
// reachable from the repo root (skipping node_modules/.next/.git and other
// generated/tooling dirs). Run via `npm run lint`.
import { execFileSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SKIP = new Set(['node_modules', '.next', '.git', '.claude', '.impeccable']);

let checked = 0;
let failed = false;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
    } else if (entry.endsWith('.js')) {
      try {
        execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
        checked++;
      } catch (err) {
        failed = true;
        console.error(`SYNTAX ERROR: ${full}`);
        console.error((err.stderr || err.stdout || '').toString().trim());
      }
    }
  }
}

walk(ROOT);

if (failed) {
  console.error(`\nlint failed: ${checked} file(s) OK, see errors above.`);
  process.exit(1);
}
console.log(`lint OK: ${checked} JS file(s) parsed without syntax errors.`);
