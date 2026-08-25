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
function sql(strings, ...values) {
  if (!sqlClient) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL (or POSTGRES_URL) is not set — required for automation');
    sqlClient = neon(url);
  }
  return sqlClient(strings, ...values);
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
          pr_url TEXT,
          pr_title TEXT,
          reason TEXT
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

export async function recordActivity(installationId, entry) {
  await ensureSchema();
  await sql`
    INSERT INTO automation_activity (installation_id, outcome, pr_url, pr_title, reason)
    VALUES (${installationId}, ${entry.outcome}, ${entry.prUrl || null}, ${entry.prTitle || null}, ${entry.reason || null})
  `;
}

export async function listActivity(installationId) {
  await ensureSchema();
  const rows = await sql`
    SELECT at, outcome, pr_url, pr_title, reason FROM automation_activity
    WHERE installation_id = ${installationId}
    ORDER BY at DESC
    LIMIT ${MAX_ACTIVITY}
  `;
  return rows.map((r) => ({ at: r.at, outcome: r.outcome, prUrl: r.pr_url, prTitle: r.pr_title, reason: r.reason }));
}
