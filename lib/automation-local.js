'use client';

// Client-side pointer to "which automation installation is mine" — the
// installation id is the only thing that ties this browser back to a
// connected GitHub account (see app/api/automation/register/route.js).
const KEY = 'PRISMLENS_AUTOMATION_ID';

export function getSavedInstallationId() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function saveInstallationId(id) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {}
}
