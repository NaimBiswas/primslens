import {
  fetchPR,
  fetchPRFiles,
  fetchAuthenticatedUser,
  replyToReviewComment,
  postIssueComment,
} from './github.js';
import { analyzePR } from './analyzer.js';
import { processChatMessage } from './chat.js';
import { loadReviewConfig } from './review-config.js';

const token = process.env.GITHUB_TOKEN;

let cachedUser = null;
async function resolveBotLogin() {
  if (cachedUser) return cachedUser;
  const user = await fetchAuthenticatedUser(token);
  cachedUser = user.login;
  return cachedUser;
}

const MAX_ACTIVITY = 20;
const activityLog = [];

function recordActivity(entry) {
  activityLog.unshift({ at: new Date().toISOString(), ...entry });
  activityLog.length = Math.min(activityLog.length, MAX_ACTIVITY);
}

function buildInlineMessage({ commentBody, path, line }) {
  return [
    `A new inline review comment was left on this PR at ${path}:${line ?? '?'}:`,
    '',
    `"${commentBody}"`,
    '',
    'Read the actual code at that location. If the comment implies or requests a code change, ' +
      'prepare a fix preview for it exactly like you would for a normal fix request — do not commit. ' +
      'If it is a question or does not require a code change, answer it directly and concisely based on the code and the review findings.',
  ].join('\n');
}

function buildGeneralMessage({ commentBody }) {
  return [
    'A new comment was left on this PR:',
    '',
    `"${commentBody}"`,
    '',
    'Read the PR diff and the review findings. If the comment implies or requests a code change, ' +
      'prepare a fix preview for it exactly like you would for a normal fix request — do not commit. ' +
      'If it is a question or does not require a code change, answer it directly and concisely.',
  ].join('\n');
}

/**
 * Reacts to a single GitHub webhook comment event: decides whether it's
 * relevant (assigned to / authored by the token owner, not our own reply),
 * runs it through the same chat agent the interactive UI uses, and posts
 * the reply back to the right place. Propose-only — never commits.
 */
export async function processAutomatedComment({ eventType, payload }) {
  if (!token) return { skipped: 'no GITHUB_TOKEN configured' };

  const comment = payload.comment;
  if (!comment) return { skipped: 'no comment in payload' };

  const me = await resolveBotLogin();

  // Loop guard: never react to our own replies.
  if (comment.user?.login === me) return { skipped: 'own comment' };

  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const prNumber = eventType === 'issue_comment' ? payload.issue?.number : payload.pull_request?.number;
  if (!owner || !repo || !prNumber) return { skipped: 'missing repo/PR identifiers' };

  const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
  const base = { prUrl, eventType };

  try {
    const pr = await fetchPR(prUrl, token);
    const isAssignee = (pr.assignees || []).some((a) => a.login === me);
    const isAuthor = pr.user?.login === me;
    if (!isAssignee && !isAuthor) {
      recordActivity({ ...base, outcome: 'skipped', reason: 'PR not assigned to or authored by token owner' });
      return { skipped: 'PR not assigned to or authored by token owner' };
    }

    const [files, config] = await Promise.all([fetchPRFiles(prUrl, token), loadReviewConfig(prUrl, token)]);
    const review = await analyzePR(pr, files, config, token);

    const message = eventType === 'pull_request_review_comment'
      ? buildInlineMessage({ commentBody: comment.body, path: comment.path, line: comment.line ?? comment.original_line })
      : buildGeneralMessage({ commentBody: comment.body });

    const result = await processChatMessage({ message, prUrl, token, review, history: [] });

    if (eventType === 'pull_request_review_comment') {
      await replyToReviewComment(prUrl, token, comment.id, result.content);
    } else {
      await postIssueComment(prUrl, token, result.content);
    }

    recordActivity({ ...base, outcome: 'replied', prTitle: pr.title });
    return { replied: true };
  } catch (err) {
    recordActivity({ ...base, outcome: 'error', reason: err.message });
    throw err;
  }
}

/**
 * Configuration + recent-activity snapshot for the Automation dashboard.
 * Never returns the token. The webhook secret itself is only included in
 * development (`next dev`) — this endpoint has no auth of its own, and
 * this app has no user-session concept to gate it behind, so returning the
 * real secret from a deployed instance would let anyone reaching it read
 * the value and forge validly-signed webhook payloads. In dev the person
 * hitting this endpoint already has the secret in their own .env file, so
 * exposing it there is just a copy-paste convenience, not a new exposure.
 */
export async function getAutomationStatus() {
  const tokenConfigured = !!token;
  const webhookSecretConfigured = !!process.env.GITHUB_WEBHOOK_SECRET;
  const exposeSecret = process.env.NODE_ENV !== 'production';

  let botLogin = null;
  if (tokenConfigured) {
    try {
      botLogin = await resolveBotLogin();
    } catch {
      botLogin = null;
    }
  }

  return {
    tokenConfigured,
    webhookSecretConfigured,
    webhookSecret: exposeSecret ? (process.env.GITHUB_WEBHOOK_SECRET || null) : null,
    botLogin,
    recentActivity: activityLog,
  };
}
