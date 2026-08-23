import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const PROJECT_ROOT = join(__dirname, '..', '..');
const CONFIG_FILE = join(PROJECT_ROOT, '.prismlens-config.json');

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    cache = {};
  }
  return cache;
}

/** The selected `provider/model` id, or null to use opencode's own default. */
export function getSelectedModel() {
  return load().model || null;
}

export function setSelectedModel(model) {
  const data = { ...load() };
  if (model) data.model = model;
  else delete data.model;
  cache = data;
  writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
