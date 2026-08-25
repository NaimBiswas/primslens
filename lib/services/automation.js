import {
  fetchPR,
  fetchPRFiles,
  fetchAuthenticatedUser,
  replyToReviewComment,
  postIssueComment,
  postPRReview,
} from './github.js';
import { analyzePR } from './analyzer.js';
import { processChatMessage } from './chat.js';
import { loadReviewConfig } from './review-config.js';
import {
  getInstallation,
  deleteInstallation,
  createInstallation,
  setInstallationBotLogin,
  recordActivity,
  listActivity,
  recordBotComment,
  isBotComment,
  getConversationHistory,
  saveConversationHistory,
  upsertPendingApproval,
  clearPendingApproval,
  listPendingApprovals,
} from './installations.js';

// Small footer appended to what actually gets posted to GitHub — lets the
// account owner match a real GitHub comment/review back to its Recent
// Activity row without leaving the PR. Not part of the AI's own reply (kept
// out of conversation history and pending-approval previews), and skipped
// entirely when there's no id to cite (e.g. the initial "received" row
// failed to write).
function withActivityFooter(body, activityId) {
  if (!activityId) return body;
  return `${body}\n\n<sub>PrismLens automation · activity #${activityId}</sub>`;
}

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

// The chat agent's system prompt (ai-chat.js) always shows a proposed fix as
// a fenced ```diff block — used here purely to decide whether a reply is
// "a preview worth surfacing in the dashboard" vs. a plain answer. Not used
// for anything security-sensitive; whether a commit actually happened comes
// from processChatMessage's own `committed` flag, not this heuristic.
const DIFF_BLOCK = /```diff/;

/**
 * Reacts to a single GitHub webhook event for one installation — an
 * `issue_comment`, `pull_request_review_comment`, or a `pull_request_review`
 * submitted with a top-level body — decides whether it's relevant (assigned
 * to / authored by that installation's own token owner, not our own reply),
 * runs it through the same chat agent the interactive UI uses, and posts
 * the reply back to the right place. Propose-only — never commits without
 * an explicit confirmation reply, which requires the conversation history
 * below to actually have the earlier preview in context.
 */
export async function processAutomatedComment({ installationId, eventType, payload, deliveryId, activityId }) {
  const installation = await getInstallation(installationId);
  if (!installation) return { skipped: 'unknown installation' };
  const { githubToken: token } = installation;

  // A `pull_request_review` with only a top-level body (no inline comments)
  // has no `payload.comment` at all — the equivalent text lives on the
  // review object instead. Normalize both shapes to the same `{ body, user }`
  // so the rest of this function doesn't need to care which one fired.
  const comment = eventType === 'pull_request_review' ? payload.review : payload.comment;
  if (!comment) {
    await recordActivity(installationId, { eventType, deliveryId, outcome: 'skipped', reason: 'no comment in payload' });
    return { skipped: 'no comment in payload' };
  }

  // Loop guard: skip only comments/reviews *we* posted ourselves — checked
  // by id, not by GitHub login, since automated replies are posted under
  // the account owner's own token. A same-login check would also silently
  // swallow the owner's own manual replies (including their "commit"
  // confirmation), which is exactly the bug this replaces.
  if (await isBotComment(installationId, comment.id)) {
    await recordActivity(installationId, { eventType, deliveryId, outcome: 'skipped', reason: 'own comment' });
    return { skipped: 'own comment' };
  }

  const me = await resolveBotLogin(installation);

  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const prNumber = eventType === 'issue_comment' ? payload.issue?.number : payload.pull_request?.number;
  if (!owner || !repo || !prNumber) {
    await recordActivity(installationId, { eventType, deliveryId, outcome: 'skipped', reason: 'missing repo/PR identifiers' });
    return { skipped: 'missing repo/PR identifiers' };
  }

  const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
  const base = { prUrl, eventType, deliveryId };

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

    const history = await getConversationHistory(installationId, prUrl);
    const result = await processChatMessage({ message, prUrl, token, review, history, aiOverride: null });

    const body = withActivityFooter(result.content, activityId);
    let posted;
    if (eventType === 'pull_request_review_comment') {
      posted = await replyToReviewComment(prUrl, token, comment.id, body);
    } else {
      posted = await postIssueComment(prUrl, token, body);
    }
    // Our own reply must never itself be mistaken for a fresh trigger the
    // next time a webhook fires for this PR.
    await recordBotComment(installationId, posted?.id);

    await saveConversationHistory(installationId, prUrl, [
      ...history,
      { role: 'user', content: message },
      { role: 'assistant', content: result.content },
    ]);

    if (result.committed) {
      await clearPendingApproval(installationId, prUrl);
    } else if (DIFF_BLOCK.test(result.content || '')) {
      await upsertPendingApproval(installationId, prUrl, pr.title, result.content);
    }

    await recordActivity(installationId, { ...base, outcome: 'replied', prTitle: pr.title });
    return { replied: true };
  } catch (err) {
    await recordActivity(installationId, { ...base, outcome: 'error', reason: err.message });
    throw err;
  }
}

/**
 * Reacts to a PR being opened on a watched repo: runs the full 6-dimension
 * review and posts it as a PR review comment, the same content a manual
 * "Comment" click in the dashboard would produce. Every PR on the repo gets
 * reviewed — unlike processAutomatedComment, there's no assignee/author
 * filter here, since the webhook itself is already scoped to repos this
 * account chose to watch.
 */
export async function processAutomatedPullRequest({ installationId, payload, deliveryId, activityId }) {
  const installation = await getInstallation(installationId);
  if (!installation) return { skipped: 'unknown installation' };
  const { githubToken: token } = installation;

  const pr = payload.pull_request;
  if (!pr) {
    await recordActivity(installationId, { eventType: 'pull_request', deliveryId, outcome: 'skipped', reason: 'no pull_request in payload' });
    return { skipped: 'no pull_request in payload' };
  }

  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const prUrl = pr.html_url || `https://github.com/${owner}/${repo}/pull/${pr.number}`;
  const base = { prUrl, eventType: 'pull_request', deliveryId };

  try {
    const [prData, files, config] = await Promise.all([
      fetchPR(prUrl, token),
      fetchPRFiles(prUrl, token),
      loadReviewConfig(prUrl, token),
    ]);
    const review = await analyzePR(prData, files, config, token);
    const footer = withActivityFooter('', activityId);
    const posted = await postPRReview(prUrl, token, review, 'COMMENT', footer);
    // A posted review itself fires a pull_request_review webhook event —
    // record its id so that event doesn't get treated as a fresh comment.
    await recordBotComment(installationId, posted?.id);

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

/**
 * Approves a pending fix by posting a "commit" comment on the PR using the
 * account's own token — this is deliberately the same trigger a human
 * typing "commit" on GitHub would produce, so it flows through the normal
 * webhook pipeline (with full conversation history) rather than a separate
 * code path. Not recorded via recordBotComment: this comment is meant to be
 * *processed* as a genuine confirmation, not ignored as our own echo.
 */
export async function approvePendingApproval(installationId, prUrl) {
  const installation = await getInstallation(installationId);
  if (!installation) throw new Error('Unknown installation');
  await postIssueComment(prUrl, installation.githubToken, 'commit');
}

export async function dismissPendingApproval(installationId, prUrl) {
  await clearPendingApproval(installationId, prUrl);
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

  const [recentActivity, pendingApprovals] = await Promise.all([
    listActivity(installationId),
    listPendingApprovals(installationId),
  ]);
  return {
    id: installation.id,
    label: installation.label,
    webhookSecret: installation.webhookSecret,
    botLogin,
    recentActivity,
    pendingApprovals,
  };
}
