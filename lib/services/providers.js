import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const CATALOG_URL = 'https://models.dev/api.json';
const AUTH_FILE = join(homedir(), '.local', 'share', 'opencode', 'auth.json');

let cachedCatalog = null;

/**
 * The full models.dev provider+model catalog opencode itself is built on
 * (same data it caches to ~/.cache/opencode/models.json) — fetched directly
 * so this works even on a machine that has never run opencode interactively.
 * Cached in-memory for the process lifetime; it's a large, slow-changing
 * public catalog, not something worth re-fetching per request.
 */
async function fetchCatalog() {
  if (cachedCatalog) return cachedCatalog;
  const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`models.dev responded ${res.status}`);
  cachedCatalog = await res.json();
  return cachedCatalog;
}

function readAuthFile() {
  try {
    return JSON.parse(readFileSync(AUTH_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeAuthFile(data) {
  const dir = dirname(AUTH_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function getConfiguredProviderIds() {
  return Object.keys(readAuthFile());
}

/**
 * Slim summary of every provider opencode/models.dev knows about — no
 * per-model detail, so this stays a small payload even across ~190
 * providers. Model detail is fetched per-provider, on demand.
 */
export async function listProviders() {
  const catalog = await fetchCatalog();
  const configured = new Set(getConfiguredProviderIds());
  return Object.values(catalog)
    .map((p) => ({
      id: p.id,
      name: p.name,
      envVars: p.env || [],
      doc: p.doc || null,
      modelCount: Object.keys(p.models || {}).length,
      configured: configured.has(p.id),
    }))
    .filter((p) => p.modelCount > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listProviderModels(providerId) {
  const catalog = await fetchCatalog();
  const provider = catalog[providerId];
  if (!provider) return [];
  return Object.values(provider.models || {}).map((m) => ({
    id: `${providerId}/${m.id}`,
    name: m.name,
    context: m.limit?.context ?? null,
    cost: m.cost ?? null,
    free: !m.cost || (m.cost.input === 0 && m.cost.output === 0),
  }));
}

export async function setProviderApiKey(providerId, apiKey) {
  const catalog = await fetchCatalog();
  if (!catalog[providerId]) throw new Error('Unknown provider');
  const data = readAuthFile();
  data[providerId] = { type: 'api', key: apiKey };
  writeAuthFile(data);
}

export function removeProviderCredential(providerId) {
  const data = readAuthFile();
  delete data[providerId];
  writeAuthFile(data);
}
