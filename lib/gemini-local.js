'use client';

// Client-side storage for a user-supplied Gemini API key + selected model.
// Mirrors the GitHub token pattern in CodeReviewPanel.jsx (localStorage, sent
// per-request) rather than the opencode "Providers" system's server-side
// credential file — a server-side file doesn't survive on serverless hosts
// like Vercel, so the key has to live with the browser and travel with each
// request instead.
const KEY_STORAGE = 'PRISMLENS_GEMINI_KEY';
const MODEL_STORAGE = 'PRISMLENS_GEMINI_MODEL';

export function getSavedGeminiKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}

export function saveGeminiKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {}
}

export function getSavedGeminiModel() {
  try { return localStorage.getItem(MODEL_STORAGE) || ''; } catch { return ''; }
}

export function saveGeminiModel(model) {
  try {
    if (model) localStorage.setItem(MODEL_STORAGE, model);
    else localStorage.removeItem(MODEL_STORAGE);
  } catch {}
}

// Which backend a review request should use when the user has picked a
// specific model row in the unified Models list — 'opencode' or 'gemini'.
// Empty/unset means "no explicit choice yet": the server falls back to its
// own default (its GEMINI_API_KEY env var if set, else opencode), same as
// before this selector existed, so a self-hosted deployment that never
// touches this UI keeps working unchanged.
const SOURCE_STORAGE = 'PRISMLENS_MODEL_SOURCE';

export function getActiveModelSource() {
  try { return localStorage.getItem(SOURCE_STORAGE) || ''; } catch { return ''; }
}

export function setActiveModelSource(source) {
  try {
    if (source) localStorage.setItem(SOURCE_STORAGE, source);
    else localStorage.removeItem(SOURCE_STORAGE);
  } catch {}
}
