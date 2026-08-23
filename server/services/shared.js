import { access } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const PROJECT_ROOT = join(__dirname, '..', '..');
const BIN_NAME = process.platform === 'win32' ? 'opencode.exe' : 'opencode';

export const OPENCODE_CANDIDATES = [
  // Installed as a project dependency (npm install opencode-ai) — preferred: reproducible, cross-platform.
  join(PROJECT_ROOT, 'node_modules', 'opencode-ai', 'bin', BIN_NAME),
  // Global npm install.
  join(process.execPath, '..', 'node_modules', 'opencode-ai', 'bin', BIN_NAME),
  join(process.env.LOCALAPPDATA || '', 'opencode', 'opencode.exe'),
  join(process.env.APPDATA || '', 'npm', 'node_modules', 'opencode-ai', 'bin', BIN_NAME),
  'opencode.exe',
];

export function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

export async function findOpenCode() {
  for (const candidate of OPENCODE_CANDIDATES) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}
