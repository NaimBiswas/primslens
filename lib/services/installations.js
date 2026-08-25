import { neon } from '@neondatabase/serverless';
import { randomBytes, randomUUID } from 'crypto';
import { encryptSecret, decryptSecret } from './crypto.js';

// One automation "installation" per user who connects their own GitHub
// account — this is what makes automation multi-tenant: each row carries
// its own GitHub token and webhook secret, looked up by the installation id
// embedded in that user's own unique webhook URL, instead of one global
// GITHUB_TOKEN/GITHUB_WEBHOOK_SECRET pair every user would otherwise have
// to share (which only ever worked for whoever deployed the server).
let sqlClient = null;

// Neon's HTTP driver surfaces cold-start/network blips (the compute
// auto-suspends on the free tier, so the first query after idle time can
// hit before it's woken back up) as plain fetch failures, not anything
// Postgres-specific — retrying a couple times a moment later is the
// documented workaround and is enough to ride out a wake-up, without
// masking a real, persistent DB problem.
const TRANSIENT_DB_ERROR = /fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|network|Error connecting to database/i;
const RETRY_DELAYS_MS = [300, 900];

async function sql(strings, ...values) {
  if (!sqlClient) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL (or POSTGRES_URL) is not set — required for automation');
    sqlClient = neon(url);
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await sqlClient(strings, ...values);
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !TRANSIENT_DB_ERROR.test(err.message || '')) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS automation_installations (
          id TEXT PRIMARY KEY,
          label TEXT,
          github_token_encrypted TEXT NOT NULL,
          webhook_secret_encrypted TEXT NOT NULL,
          bot_login TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS automation_activity (
          id BIGSERIAL PRIMARY KEY,
          installation_id TEXT NOT NULL REFERENCES automation_installations(id) ON DELETE CASCADE,
          at TIMESTAMPTZ NOT NULL DEFAULT now(),
          outcome TEXT NOT NULL,
          event_type TEXT,
          pr_url TEXT,
          pr_title TEXT,
          reason TEXT,
          delivery_id TEXT
        )
      `;
      // Added after the table already existed in deployed installations —
      // ADD COLUMN IF NOT EXISTS keeps this idempotent for both fresh and
      // pre-existing databases.
      await sql`ALTER TABLE automation_activity ADD COLUMN IF NOT EXISTS event_type TEXT`;
      await sql`ALTER TABLE automation_activity ADD COLUMN IF NOT EXISTS delivery_id TEXT`;
      // GitHub's own delivery id for the event, so the "received" row this
      // webhook's handler inserts up front and the "replied"/"skipped"/
      // "error" row the background processing later writes for that *same*
      // event land as one updated row instead of two permanent ones.
      // Partial (delivery_id IS NOT NULL) so multiple older rows recorded
      // before this column existed, or any future call that doesn't have a
      // delivery id to key off of, don't collide with each other via NULL.
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS automation_activity_delivery_uniq
        ON automation_activity (installation_id, delivery_id)
        WHERE delivery_id IS NOT NULL
      `;
      // Ids of comments/reviews *we* posted (replies, auto-reviews) — lets
      // the loop guard tell "our own reply came back as a webhook event"
      // apart from "the account owner posted a genuine new comment", which
      // a same-author check can't do since both are posted under the same
      // GitHub identity (this uses the account's own token, not a separate
      // bot account).
      await sql`
        CREATE TABLE IF NOT EXISTS automation_bot_comments (
          installation_id TEXT NOT NULL REFERENCES automation_installations(id) ON DELETE CASCADE,
          comment_id BIGINT NOT NULL,
          PRIMARY KEY (installation_id, comment_id)
        )
      `;
      // Per-PR chat history, so a later "commit" reply actually has the
      // earlier preview turn in context instead of starting fresh each time
      // a webhook fires.
      await sql`
        CREATE TABLE IF NOT EXISTS automation_conversations (
          installation_id TEXT NOT NULL REFERENCES automation_installations(id) ON DELETE CASCADE,
          pr_url TEXT NOT NULL,
          history JSONB NOT NULL DEFAULT '[]',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (installation_id, pr_url)
        )
      `;
      // One row per PR currently awaiting the account owner's approval —
      // lets the dashboard show the proposed diff without visiting GitHub.
      await sql`
        CREATE TABLE IF NOT EXISTS automation_pending_approvals (
          installation_id TEXT NOT NULL REFERENCES automation_installations(id) ON DELETE CASCADE,
          pr_url TEXT NOT NULL,
          pr_title TEXT,
          preview TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (installation_id, pr_url)
        )
      `;
    })();
  }
  return schemaReady;
}

function rowToInstallation(row) {
  return {
    id: row.id,
    label: row.label,
    githubToken: decryptSecret(row.github_token_encrypted),
    webhookSecret: decryptSecret(row.webhook_secret_encrypted),
    botLogin: row.bot_login,
    createdAt: row.created_at,
  };
}

/** Creates a new installation with a freshly generated webhook secret. */
export async function createInstallation({ githubToken, label }) {
  await ensureSchema();
  const id = randomUUID();
  const webhookSecret = randomBytes(24).toString('hex');
  await sql`
    INSERT INTO automation_installations (id, label, github_token_encrypted, webhook_secret_encrypted)
    VALUES (${id}, ${label || null}, ${encryptSecret(githubToken)}, ${encryptSecret(webhookSecret)})
  `;
  return { id, webhookSecret };
}

export async function getInstallation(id) {
  await ensureSchema();
  const rows = await sql`SELECT * FROM automation_installations WHERE id = ${id}`;
  return rows.length ? rowToInstallation(rows[0]) : null;
}

export async function setInstallationBotLogin(id, botLogin) {
  await ensureSchema();
  await sql`UPDATE automation_installations SET bot_login = ${botLogin} WHERE id = ${id}`;
}

export async function deleteInstallation(id) {
  await ensureSchema();
  await sql`DELETE FROM automation_installations WHERE id = ${id}`;
}

const MAX_ACTIVITY = 20;

/**
 * Records one activity row — or, when `entry.deliveryId` is given, updates
 * the existing row for that same webhook delivery in place instead of
 * adding a new one. This is what lets a "received" row (written the instant
 * the webhook lands) turn into the eventual "replied"/"skipped"/"error" row
 * once background processing finishes, rather than leaving the "received"
 * row stuck forever and appending a second, separate row for the outcome.
 * Without a deliveryId (some early-exit branches don't have one threaded
 * through) this always inserts a fresh row, same as before.
 */
export async function recordActivity(installationId, entry) {
  await ensureSchema();
  await sql`
    INSERT INTO automation_activity (installation_id, outcome, event_type, pr_url, pr_title, reason, delivery_id, at)
    VALUES (${installationId}, ${entry.outcome}, ${entry.eventType || null}, ${entry.prUrl || null}, ${entry.prTitle || null}, ${entry.reason || null}, ${entry.deliveryId || null}, now())
    ON CONFLICT (installation_id, delivery_id) WHERE delivery_id IS NOT NULL
    DO UPDATE SET
      outcome = EXCLUDED.outcome,
      event_type = EXCLUDED.event_type,
      pr_url = EXCLUDED.pr_url,
      pr_title = EXCLUDED.pr_title,
      reason = EXCLUDED.reason,
      at = now()
  `;
}

export async function listActivity(installationId) {
  await ensureSchema();
  const rows = await sql`
    SELECT at, outcome, event_type, pr_url, pr_title, reason FROM automation_activity
    WHERE installation_id = ${installationId}
    ORDER BY at DESC
    LIMIT ${MAX_ACTIVITY}
  `;
  return rows.map((r) => ({
    at: r.at,
    outcome: r.outcome,
    eventType: r.event_type,
    prUrl: r.pr_url,
    prTitle: r.pr_title,
    reason: r.reason,
  }));
}

/** Records a comment/review id as one *we* posted (see automation_bot_comments above). */
export async function recordBotComment(installationId, commentId) {
  if (!commentId) return;
  await ensureSchema();
  await sql`
    INSERT INTO automation_bot_comments (installation_id, comment_id)
    VALUES (${installationId}, ${commentId})
    ON CONFLICT DO NOTHING
  `;
}

export async function isBotComment(installationId, commentId) {
  if (!commentId) return false;
  await ensureSchema();
  const rows = await sql`
    SELECT 1 FROM automation_bot_comments WHERE installation_id = ${installationId} AND comment_id = ${commentId}
  `;
  return rows.length > 0;
}

const MAX_HISTORY_TURNS = 20;

export async function getConversationHistory(installationId, prUrl) {
  await ensureSchema();
  const rows = await sql`
    SELECT history FROM automation_conversations WHERE installation_id = ${installationId} AND pr_url = ${prUrl}
  `;
  return rows.length ? rows[0].history : [];
}

export async function saveConversationHistory(installationId, prUrl, history) {
  await ensureSchema();
  const trimmed = history.slice(-MAX_HISTORY_TURNS);
  await sql`
    INSERT INTO automation_conversations (installation_id, pr_url, history, updated_at)
    VALUES (${installationId}, ${prUrl}, ${JSON.stringify(trimmed)}, now())
    ON CONFLICT (installation_id, pr_url) DO UPDATE SET history = ${JSON.stringify(trimmed)}, updated_at = now()
  `;
}

/** Records or replaces the one pending preview for a PR — a new proposal supersedes the last. */
export async function upsertPendingApproval(installationId, prUrl, prTitle, preview) {
  await ensureSchema();
  await sql`
    INSERT INTO automation_pending_approvals (installation_id, pr_url, pr_title, preview, created_at)
    VALUES (${installationId}, ${prUrl}, ${prTitle || null}, ${preview}, now())
    ON CONFLICT (installation_id, pr_url) DO UPDATE SET pr_title = ${prTitle || null}, preview = ${preview}, created_at = now()
  `;
}

export async function clearPendingApproval(installationId, prUrl) {
  await ensureSchema();
  await sql`DELETE FROM automation_pending_approvals WHERE installation_id = ${installationId} AND pr_url = ${prUrl}`;
}

export async function listPendingApprovals(installationId) {
  await ensureSchema();
  const rows = await sql`
    SELECT pr_url, pr_title, preview, created_at FROM automation_pending_approvals
    WHERE installation_id = ${installationId}
    ORDER BY created_at DESC
  `;
  return rows.map((r) => ({ prUrl: r.pr_url, prTitle: r.pr_title, preview: r.preview, createdAt: r.created_at }));
}
