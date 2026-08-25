import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import { verifyGithubSignature, skipReason } from '../lib/webhook-verify.js';
import { isFromBot } from '../lib/services/automation.js';

const SECRET = 'test-secret';

function sign(body, secret = SECRET) {
  return 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

test('verifyGithubSignature accepts a correctly signed body', () => {
  const body = JSON.stringify({ hello: 'world' });
  assert.equal(verifyGithubSignature(body, sign(body), SECRET), true);
});

test('verifyGithubSignature rejects a tampered body', () => {
  const body = JSON.stringify({ hello: 'world' });
  const signature = sign(body);
  const tampered = JSON.stringify({ hello: 'werld' });
  assert.equal(verifyGithubSignature(tampered, signature, SECRET), false);
});

test('verifyGithubSignature rejects a signature made with the wrong secret', () => {
  const body = JSON.stringify({ hello: 'world' });
  assert.equal(verifyGithubSignature(body, sign(body, 'wrong-secret'), SECRET), false);
});

test('verifyGithubSignature rejects a missing signature header', () => {
  const body = JSON.stringify({ hello: 'world' });
  assert.equal(verifyGithubSignature(body, null, SECRET), false);
});

test('verifyGithubSignature rejects when no secret is configured', () => {
  const body = JSON.stringify({ hello: 'world' });
  assert.equal(verifyGithubSignature(body, sign(body), undefined), false);
});

test('skipReason: issue_comment on a plain issue (no pull_request field) is skipped', () => {
  const reason = skipReason('issue_comment', { action: 'created', issue: { number: 1 } });
  assert.match(reason, /not a PR/);
});

test('skipReason: issue_comment on a PR with action=created proceeds', () => {
  const reason = skipReason('issue_comment', { action: 'created', issue: { number: 1, pull_request: {} } });
  assert.equal(reason, null);
});

test('skipReason: non-created actions (edited/deleted) are skipped', () => {
  assert.match(
    skipReason('issue_comment', { action: 'edited', issue: { pull_request: {} } }),
    /not a created action/
  );
  assert.match(
    skipReason('pull_request_review_comment', { action: 'deleted', pull_request: {} }),
    /not a created action/
  );
});

test('skipReason: pull_request_review_comment with action=created proceeds', () => {
  const reason = skipReason('pull_request_review_comment', { action: 'created', pull_request: { number: 1 } });
  assert.equal(reason, null);
});

test('skipReason: unhandled event types are skipped', () => {
  assert.match(skipReason('push', { ref: 'refs/heads/main' }), /unhandled event type/);
});

test('skipReason: pull_request opened proceeds', () => {
  const reason = skipReason('pull_request', { action: 'opened', pull_request: { number: 1 } });
  assert.equal(reason, null);
});

test('skipReason: pull_request with a non-opened action is skipped', () => {
  assert.match(
    skipReason('pull_request', { action: 'closed', pull_request: { number: 1 } }),
    /not an opened action/
  );
});

test('skipReason: pull_request_review submitted with a body proceeds', () => {
  const reason = skipReason('pull_request_review', {
    action: 'submitted',
    pull_request: { number: 1 },
    review: { body: 'Looks good, one nit below' },
  });
  assert.equal(reason, null);
});

test('skipReason: pull_request_review with no body text is skipped', () => {
  assert.match(
    skipReason('pull_request_review', { action: 'submitted', review: { body: '' } }),
    /no body text/
  );
  assert.match(
    skipReason('pull_request_review', { action: 'submitted', review: { body: '   ' } }),
    /no body text/
  );
  assert.match(
    skipReason('pull_request_review', { action: 'submitted' }),
    /no body text/
  );
});

test('skipReason: pull_request_review with a non-submitted action is skipped', () => {
  assert.match(
    skipReason('pull_request_review', { action: 'dismissed', review: { body: 'nvm' } }),
    /not a submitted action/
  );
});

test('isFromBot: true for GitHub App/bot accounts (type: "Bot")', () => {
  assert.equal(isFromBot({ user: { login: 'vercel[bot]', type: 'Bot' } }), true);
  assert.equal(isFromBot({ user: { login: 'github-actions[bot]', type: 'Bot' } }), true);
});

test('isFromBot: true for a [bot]-suffixed login even without a type field', () => {
  assert.equal(isFromBot({ user: { login: 'dependabot[bot]' } }), true);
});

test('isFromBot: false for a real user', () => {
  assert.equal(isFromBot({ user: { login: 'octocat', type: 'User' } }), false);
});

test('isFromBot: false when there is no user at all', () => {
  assert.equal(isFromBot({}), false);
  assert.equal(isFromBot(null), false);
});
