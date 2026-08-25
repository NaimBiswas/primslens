import { NextResponse, after } from 'next/server';
import { verifyGithubSignature, skipReason } from '../../../../../lib/webhook-verify.js';
import { processAutomatedComment } from '../../../../../lib/services/automation.js';
import { getInstallation } from '../../../../../lib/services/installations.js';

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

/**
 * POST /api/webhooks/github/[installationId]
 * Every connected GitHub account gets its own webhook URL (see
 * lib/services/automation.js's registerInstallation) — `installationId`
 * looks up that one user's own token + webhook secret, so this route never
 * relies on server-wide env vars the way it used to. Verifies the
 * signature against that installation's secret, and — for comments on PRs
 * assigned to or authored by its token's owner — analyzes the comment and
 * replies. Propose-only: never commits a code change on its own.
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
  if (skip) {
    return NextResponse.json({ ok: true, skipped: skip });
  }

  // Ack immediately — the actual AI review call can take minutes, far
  // longer than GitHub's webhook delivery timeout.
  after(() => {
    processAutomatedComment({ installationId, eventType, payload }).catch((err) => {
      console.error('[webhooks/github] automation failed:', err.message);
    });
  });

  return NextResponse.json({ ok: true });
}
