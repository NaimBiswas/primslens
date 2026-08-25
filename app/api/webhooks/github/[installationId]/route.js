import { NextResponse, after } from 'next/server';
import { verifyGithubSignature, skipReason } from '../../../../../lib/webhook-verify.js';
import { processAutomatedComment, processAutomatedPullRequest } from '../../../../../lib/services/automation.js';
import { getInstallation, recordActivity } from '../../../../../lib/services/installations.js';

export const runtime = 'nodejs';

// Bounded recent-delivery-ID set — GitHub occasionally redelivers on retry.
const seenDeliveries = new Set();
const MAX_SEEN = 500;
function alreadySeen(id) {
  if (!id) return false;
  if (seenDeliveries.has(id)) return true;
  seenDeliveries.add(id);
  if (seenDeliveries.size > MAX_SEEN) {
    seenDeliveries.delete(seenDeliveries.values().next().value);
  }
  return false;
}

// Best-effort PR link for the immediate "received" activity row — payload
// shapes differ per event type, and this only needs to be good enough for a
// clickable link in the dashboard, not authoritative (processAutomated*
// re-fetches the real PR from the API before doing anything with it).
function extractPrRef(eventType, payload) {
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  if (!owner || !repo) return {};
  const pr = eventType === 'issue_comment' ? payload.issue : payload.pull_request;
  if (!pr?.number) return {};
  return { prUrl: `https://github.com/${owner}/${repo}/pull/${pr.number}`, prTitle: pr.title };
}

/**
 * POST /api/webhooks/github/[installationId]
 * Every connected GitHub account gets its own webhook URL (see
 * lib/services/automation.js's registerInstallation) — `installationId`
 * looks up that one user's own token + webhook secret, so this route never
 * relies on server-wide env vars the way it used to. Verifies the
 * signature against that installation's secret, then dispatches by event:
 * `pull_request` (opened) always gets a full auto-review posted as a PR
 * comment; `issue_comment` / `pull_request_review_comment` /
 * `pull_request_review` react only on PRs assigned to or authored by the
 * token's owner, replying via the same propose-then-confirm chat flow the
 * interactive UI uses — never commits without an explicit confirmation.
 */
export async function POST(req, { params }) {
  const { installationId } = await params;
  let installation;
  try {
    installation = await getInstallation(installationId);
  } catch (err) {
    return NextResponse.json({ error: `Automation not configured: ${err.message}` }, { status: 501 });
  }
  if (!installation) {
    return NextResponse.json({ error: 'Unknown automation installation' }, { status: 404 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256');
  if (!verifyGithubSignature(rawBody, signature, installation.webhookSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const deliveryId = req.headers.get('x-github-delivery');
  if (alreadySeen(deliveryId)) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  const eventType = req.headers.get('x-github-event');
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const skip = skipReason(eventType, payload);
  const { prUrl, prTitle } = extractPrRef(eventType, payload);

  if (skip) {
    // Still worth a row — this is exactly the gap that made a real,
    // successfully-delivered webhook look like it never arrived.
    await recordActivity(installationId, { eventType, prUrl, prTitle, outcome: 'skipped', reason: skip, deliveryId }).catch(() => {});
    return NextResponse.json({ ok: true, skipped: skip });
  }

  // Show up in the queue the moment the event lands — the real outcome
  // (replied/skipped/error) can take minutes to follow, once the
  // backgrounded AI call below finishes. Carrying deliveryId through to
  // processAutomated* lets that later outcome update this same row instead
  // of appending a second one for the same event; carrying the row's own id
  // lets the reply actually posted to GitHub cite it, so a GitHub comment
  // can be matched back to its dashboard row.
  const activityId = await recordActivity(installationId, { eventType, prUrl, prTitle, outcome: 'received', deliveryId }).catch(() => undefined);

  // Ack immediately — the actual AI review call can take minutes, far
  // longer than GitHub's webhook delivery timeout.
  after(() => {
    const task = eventType === 'pull_request'
      ? processAutomatedPullRequest({ installationId, payload, deliveryId, activityId })
      : processAutomatedComment({ installationId, eventType, payload, deliveryId, activityId });
    task.catch((err) => {
      console.error('[webhooks/github] automation failed:', err.message);
    });
  });

  return NextResponse.json({ ok: true });
}
