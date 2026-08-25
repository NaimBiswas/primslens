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
import {
  createInstallation,
  getInstallation,
  deleteInstallation,
  setInstallationBotLogin,
  recordActivity,
  listActivity,
} from './installations.js';

async function resolveBotLogin(installation) {
  if (installation.botLogin) return installation.botLogin;
  const user = await fetchAuthenticatedUser(installation.githubToken);
  await setInstallationBotLogin(installation.id, user.login);
  return user.login;
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
 * Reacts to a single GitHub webhook event for one installation — an
 * `issue_comment`, `pull_request_review_comment`, or a `pull_request_review`
 * submitted with a top-level body — decides whether it's relevant (assigned
 * to / authored by that installation's own token owner, not our own reply),
 * runs it through the same chat agent the interactive UI uses, and posts
 * the reply back to the right place. Propose-only — never commits.
 */
export async function processAutomatedComment({ installationId, eventType, payload }) {
  const installation = await getInstallation(installationId);
  if (!installation) return { skipped: 'unknown installation' };
  const { githubToken: token } = installation;

  // A `pull_request_review` with only a top-level body (no inline comments)
  // has no `payload.comment` at all — the equivalent text lives on the
  // review object instead. Normalize both shapes to the same `{ body, user }`
  // so the rest of this function doesn't need to care which one fired.
  const comment = eventType === 'pull_request_review' ? payload.review : payload.comment;
  if (!comment) return { skipped: 'no comment in payload' };

  const me = await resolveBotLogin(installation);

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
      await recordActivity(installationId, { ...base, outcome: 'skipped', reason: 'PR not assigned to or authored by token owner' });
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

    await recordActivity(installationId, { ...base, outcome: 'replied', prTitle: pr.title });
    return { replied: true };
  } catch (err) {
    await recordActivity(installationId, { ...base, outcome: 'error', reason: err.message });
    throw err;
  }
}

/**
 * Connects a new GitHub account for automation: stores the token and a
 * freshly generated webhook secret (both encrypted at rest — see
 * lib/services/crypto.js), and resolves the bot's own login up front so
 * later webhook events don't pay that round trip. Returns the id + secret
 * once; the caller (the Model/Automation UI) is responsible for keeping
 * track of the id client-side (see lib/ai-local.js-style localStorage
 * pattern) to look its own status up again later.
 */
export async function registerInstallation({ githubToken, label }) {
  const { id, webhookSecret } = await createInstallation({ githubToken, label });
  try {
    const user = await fetchAuthenticatedUser(githubToken);
    await setInstallationBotLogin(id, user.login);
  } catch {
    // Bad token or transient GitHub error — the installation still exists;
    // resolveBotLogin() retries lazily on the first real webhook event.
  }
  return { id, webhookSecret };
}

export async function removeInstallation(installationId) {
  await deleteInstallation(installationId);
}

/** Status + recent-activity snapshot for one installation's dashboard. */
export async function getInstallationStatus(installationId) {
  const installation = await getInstallation(installationId);
  if (!installation) return null;

  let botLogin = installation.botLogin;
  if (!botLogin) {
    try {
      botLogin = await resolveBotLogin(installation);
    } catch {
      botLogin = null;
    }
  }

  const recentActivity = await listActivity(installationId);
  return {
    id: installation.id,
    label: installation.label,
    webhookSecret: installation.webhookSecret,
    botLogin,
    recentActivity,
  };
}
