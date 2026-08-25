// Shared display helpers for an automation_activity row — used by both the
// Automation page (which links out to the full history) and the Recent
// Activity page (which lists it), so the two never drift out of sync on
// what a badge/label actually says.

export const ACTIVITY_BADGE_CLASS = {
  received: 'activityReceived',
  replied: 'activityReplied',
  skipped: 'activitySkipped',
  error: 'activityError',
};

export const OUTCOME_LABEL = {
  received: 'queued',
  replied: 'replied',
  skipped: 'skipped',
  error: 'error',
};

// What kind of thing this event actually was, so the badge can read
// "queued review" / "replied comment" instead of a bare outcome word —
// events an installation isn't set up to act on (a plain `push`, etc.)
// have no entry here and just fall back to the outcome alone.
export const EVENT_LABEL = {
  pull_request: 'review',
  issue_comment: 'comment',
  pull_request_review_comment: 'inline comment',
  pull_request_review: 'review comment',
};

export function activityLabel(entry) {
  const outcome = OUTCOME_LABEL[entry.outcome] || entry.outcome;
  const action = EVENT_LABEL[entry.eventType];
  return action ? `${outcome} ${action}` : outcome;
}

// The PR number isn't stored separately — it's already in the URL
// (.../pull/123), so pull it back out for display rather than adding a
// column just to hold a value derivable from one already there.
export function prNumberOf(prUrl) {
  const match = /\/pull\/(\d+)/.exec(prUrl || '');
  return match ? match[1] : null;
}
