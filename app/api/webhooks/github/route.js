import { NextResponse, after } from 'next/server';
import { verifyGithubSignature, skipReason } from '../../../../lib/webhook-verify.js';
import { processAutomatedComment } from '../../../../lib/services/automation.js';

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
 * POST /api/webhooks/github
 * Receives PR comment events (issue_comment, pull_request_review_comment),
 * verifies the signature, and — for comments on PRs assigned to or
 * authored by the configured GITHUB_TOKEN's owner — analyzes the comment
 * and replies. Propose-only: never commits a code change on its own.
 */
export async function POST(req) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const token = process.env.GITHUB_TOKEN;
  if (!secret || !token) {
    return NextResponse.json(
      { error: 'Automation not configured: set GITHUB_WEBHOOK_SECRET and GITHUB_TOKEN' },
      { status: 501 }
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256');
  if (!verifyGithubSignature(rawBody, signature, secret)) {
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
    processAutomatedComment({ eventType, payload }).catch((err) => {
      console.error('[webhooks/github] automation failed:', err.message);
    });
  });

  return NextResponse.json({ ok: true });
}
