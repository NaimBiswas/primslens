import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verifies a GitHub webhook's X-Hub-Signature-256 header against the raw
 * request body. Must run against the raw (unparsed) body — the parsed-then-
 * restringified JSON is not guaranteed byte-identical to what GitHub signed.
 */
export function verifyGithubSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Decides whether a webhook delivery is one PrismLens automation should act
 * on. Returns null when it should proceed, or a string reason when it
 * should be skipped (no-op 200, not an error).
 */
export function skipReason(eventType, payload) {
  if (eventType === 'issue_comment') {
    if (payload.action !== 'created') return 'not a created action';
    if (!payload.issue?.pull_request) return 'comment is on an issue, not a PR';
    return null;
  }
  if (eventType === 'pull_request_review_comment') {
    if (payload.action !== 'created') return 'not a created action';
    return null;
  }
  return `unhandled event type: ${eventType}`;
}
