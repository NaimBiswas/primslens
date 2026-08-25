'use client';

// Client-side storage for user-supplied AI provider API keys + which one is
// active. Kept in the browser (localStorage), not a server-side file, since
// a server-side credential store doesn't survive on serverless hosts —
// every review/chat request instead carries the active key along with it.
const KEYS_STORAGE = 'PRISMLENS_AI_KEYS'; // { [providerId]: apiKey }
const ACTIVE_STORAGE = 'PRISMLENS_AI_ACTIVE'; // { providerId, model }

function readKeys() {
  try { return JSON.parse(localStorage.getItem(KEYS_STORAGE) || '{}'); } catch { return {}; }
}

function writeKeys(keys) {
  try { localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys)); } catch {}
}

export function getSavedKey(providerId) {
  return readKeys()[providerId] || '';
}

export function saveKey(providerId, apiKey) {
  const keys = readKeys();
  if (apiKey) keys[providerId] = apiKey;
  else delete keys[providerId];
  writeKeys(keys);
}

export function getActiveBackend() {
  try { return JSON.parse(localStorage.getItem(ACTIVE_STORAGE) || 'null'); } catch { return null; }
}

export function setActiveBackend(providerId, model) {
  try {
    if (providerId) localStorage.setItem(ACTIVE_STORAGE, JSON.stringify({ providerId, model: model || null }));
    else localStorage.removeItem(ACTIVE_STORAGE);
  } catch {}
}

export function clearActiveBackendIfProvider(providerId) {
  const active = getActiveBackend();
  if (active?.providerId === providerId) setActiveBackend(null);
}

/**
 * What to send the server for a review/chat request: an explicit choice
 * made on the Model page (that provider's own key + model), or null —
 * leaving the server to fall back to whatever provider it has an env key
 * for. Centralized here so every caller (review, chat) resolves it the
 * same way instead of duplicating the logic.
 */
export function resolveAIOverride() {
  const active = getActiveBackend();
  if (!active?.providerId) return null;
  const apiKey = getSavedKey(active.providerId);
  if (!apiKey) return null;
  return { providerId: active.providerId, apiKey, model: active.model || undefined };
}
