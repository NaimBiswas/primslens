import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { findOpenCode, stripAnsi } from './shared.js';
import { getSelectedModel } from './model-config.js';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const PROJECT_ROOT = join(__dirname, '..', '..');
const CONTEXT_FILE = join(PROJECT_ROOT, '.prismlens-context.json');

function cleanOutput(output) {
  return stripAnsi(output)
    .split('\n')
    .filter((l) => !/^\s*>/.test(l) && !/^→\s*Read/.test(l))
    .join('\n')
    .trim();
}

export async function processChatMessage({ message, prUrl, token, review, history }) {
  const opencodePath = await findOpenCode();
  if (!opencodePath) {
    return { role: 'assistant', content: 'OpenCode CLI is not installed.\n\nInstall: `npm install -g opencode-ai`\nThen restart the server.' };
  }

  const context = { message, prUrl, token, review, history: history || [] };
  await writeFile(CONTEXT_FILE, JSON.stringify(context, null, 2), 'utf-8');

  try {
    const stdout = await new Promise((resolve, reject) => {
      const model = getSelectedModel();
      const args = ['run', '--agent', 'prismlens-chat'];
      if (model) args.push('-m', model);
      args.push('--dangerously-skip-permissions', '--log-level', 'ERROR', message);
      const child = spawn(opencodePath, args, { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

      let out = '';
      let errOut = '';
      child.stdout.on('data', (c) => { out += c.toString(); });
      child.stderr.on('data', (c) => { errOut += c.toString(); });

      const timer = setTimeout(() => { child.kill(); reject(new Error('Timed out after 1200s')); }, 1200000);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 || (code === null && out.length > 0)) resolve(out);
        else reject(new Error(errOut ? stripAnsi(errOut).trim().slice(0, 200) : `exit code ${code}`));
      });
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
    });

    return { role: 'assistant', content: cleanOutput(stdout) || 'No response from opencode.' };
  } catch (err) {
    return { role: 'assistant', content: `Error: ${err.message}` };
  } finally {
    try { await unlink(CONTEXT_FILE); } catch {}
  }
}
