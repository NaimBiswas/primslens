import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const PROJECT_ROOT = join(__dirname, '..', '..');
const FEEDBACK_FILE = join(PROJECT_ROOT, '.prismlens-feedback.json');
const MAX_ENTRIES = 200;
const MAX_CONTEXT_ITEMS = 10;

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(FEEDBACK_FILE, 'utf-8'));
    if (!Array.isArray(cache)) cache = [];
  } catch {
    cache = [];
  }
  return cache;
}

function save() {
  writeFileSync(FEEDBACK_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * Records a thumbs up/down on a specific finding. This is PrismLens's
 * lightweight take on "learning from feedback" (Greptile's differentiator):
 * no retraining loop, no database — just a small local log whose recent
 * "not useful" entries get fed back into the AI review prompt (see
 * getRecentDisagreements) so the same low-value pattern is less likely to
 * be flagged again on a later review.
 */
export function recordFeedback({ prUrl, issue, category, severity, vote }) {
  const entries = load();
  entries.unshift({ at: new Date().toISOString(), prUrl, issue, category, severity, vote });
  entries.length = Math.min(entries.length, MAX_ENTRIES);
  save();
}

/** Recent findings reviewers marked unhelpful (👎), for AI prompt context. */
export function getRecentDisagreements() {
  return load()
    .filter((e) => e.vote === 'down')
    .slice(0, MAX_CONTEXT_ITEMS)
    .map((e) => e.issue);
}
