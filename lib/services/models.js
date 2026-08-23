import { spawn } from 'child_process';
import { findOpenCode, stripAnsi } from './shared.js';
import { getConfiguredProviderIds, listProviderModels, listProviders } from './providers.js';

/**
 * Parses `opencode models <provider> --verbose` output: alternating
 * "provider/id" header lines and a JSON blob describing that model.
 */
export function parseModelsOutput(raw) {
  const text = stripAnsi(raw);
  const lines = text.split('\n');
  const blocks = [];
  let buf = [];

  const flush = () => {
    const joined = buf.join('\n');
    const jsonStart = joined.indexOf('{');
    if (jsonStart === -1) return;
    try {
      blocks.push(JSON.parse(joined.slice(jsonStart)));
    } catch {
      /* skip malformed block */
    }
  };

  for (const line of lines) {
    if (/^[\w.-]+\/[\w.-]+$/.test(line.trim())) {
      flush();
      buf = [];
    } else {
      buf.push(line);
    }
  }
  flush();

  return blocks;
}

let cachedFreeModels = null;

/**
 * Free (cost 0) models opencode's own "opencode" provider offers — no API
 * key or extra provider auth required. Cached for the process lifetime;
 * the catalog doesn't change during a single run.
 */
export async function listFreeModels() {
  if (cachedFreeModels) return cachedFreeModels;

  const opencodePath = await findOpenCode();
  if (!opencodePath) return [];

  const raw = await new Promise((resolve, reject) => {
    const child = spawn(opencodePath, ['models', 'opencode', '--verbose'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let errOut = '';
    child.stdout.on('data', (c) => { out += c.toString(); });
    child.stderr.on('data', (c) => { errOut += c.toString(); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Timed out listing models')); }, 20000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(errOut ? stripAnsi(errOut).trim().slice(0, 200) : `exit code ${code}`));
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
  });

  const models = parseModelsOutput(raw)
    .filter((m) => m.providerID === 'opencode' && m.cost?.input === 0 && m.cost?.output === 0)
    .map((m) => ({
      id: `${m.providerID}/${m.id}`,
      name: m.name,
      context: m.limit?.context ?? null,
    }));

  cachedFreeModels = models;
  return models;
}

/**
 * Everything the Model tab can offer: opencode's free models (always,
 * needs no setup) plus the model catalog for every provider the user has
 * since connected a credential for via the Providers section — including
 * paid ones, whose real cost travels with each entry so the picker never
 * hides that.
 */
export async function listSelectableModels() {
  const free = (await listFreeModels()).map((m) => ({
    ...m,
    cost: { input: 0, output: 0 },
    free: true,
    providerId: 'opencode',
    providerName: 'opencode',
  }));

  const configuredProviderIds = getConfiguredProviderIds().filter((id) => id !== 'opencode');
  const allProviders = await listProviders();
  const nameById = new Map(allProviders.map((p) => [p.id, p.name]));

  const extra = (await Promise.all(
    configuredProviderIds.map(async (providerId) => {
      try {
        const models = await listProviderModels(providerId);
        return models.map((m) => ({ ...m, providerId, providerName: nameById.get(providerId) || providerId }));
      } catch {
        return [];
      }
    })
  )).flat();

  return [...free, ...extra];
}
