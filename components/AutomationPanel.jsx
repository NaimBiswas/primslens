'use client';

import { useState, useEffect, useRef } from 'react';
import styles from '../app/code-review/dashboard.module.css';
import { getSavedInstallationId, saveInstallationId } from '../lib/automation-local.js';

const ACTIVITY_BADGE_CLASS = {
  received: 'activityReceived',
  replied: 'activityReplied',
  skipped: 'activitySkipped',
  error: 'activityError',
};

const OUTCOME_LABEL = {
  received: 'queued',
  replied: 'replied',
  skipped: 'skipped',
  error: 'error',
};

// What kind of thing this event actually was, so the badge can read
// "queued review" / "replied comment" instead of a bare outcome word —
// events an installation isn't set up to act on (a plain `push`, etc.)
// have no entry here and just fall back to the outcome alone.
const EVENT_LABEL = {
  pull_request: 'review',
  issue_comment: 'comment',
  pull_request_review_comment: 'inline comment',
  pull_request_review: 'review comment',
};

function activityLabel(entry) {
  const outcome = OUTCOME_LABEL[entry.outcome] || entry.outcome;
  const action = EVENT_LABEL[entry.eventType];
  return action ? `${outcome} ${action}` : outcome;
}

// The PR number isn't stored separately — it's already in the URL
// (.../pull/123), so pull it back out for display rather than adding a
// column just to hold a value derivable from one already there.
function prNumberOf(prUrl) {
  const match = /\/pull\/(\d+)/.exec(prUrl || '');
  return match ? match[1] : null;
}

export default function AutomationPanel() {
  const [installationId, setInstallationId] = useState('');
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);

  const [tokenDraft, setTokenDraft] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [resolvingPr, setResolvingPr] = useState(null);

  // PRs just approved/dismissed locally — kept hidden from every status
  // update (including polls) until the server actually stops listing them,
  // since approve/dismiss don't clear the row instantly (approve waits on a
  // real webhook round trip). A ref, not state: read inside the poll
  // interval's closure without needing to recreate that interval on change.
  const resolvedPrsRef = useRef(new Set());

  const applyStatus = (data) => {
    const resolved = resolvedPrsRef.current;
    const pending = data.pendingApprovals || [];
    for (const prUrl of resolved) {
      if (!pending.some((p) => p.prUrl === prUrl)) resolved.delete(prUrl);
    }
    setStatus({ ...data, pendingApprovals: pending.filter((p) => !resolved.has(p.prUrl)) });
  };

  // `silent` is used for the background poll below — it updates the data
  // without flashing the loading spinner or bouncing to an error state over
  // a one-off network blip; only the initial load shows those.
  const loadStatus = async (id, { silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const res = await fetch(`/api/automation/status?installationId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) {
        // Stale/deleted installation — fall back to the connect form.
        saveInstallationId('');
        setInstallationId('');
        setStatus(null);
        return;
      }
      applyStatus(data);
    } catch (err) {
      if (!silent) setLoadError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    const saved = getSavedInstallationId();
    setInstallationId(saved);
    if (saved) loadStatus(saved);
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll for new activity/pending approvals while connected — webhook
  // events land whenever GitHub feels like sending them, not on any
  // schedule the user controls, so this is what makes Recent Activity feel
  // live instead of "refresh the page and hope." Paused while the tab isn't
  // visible so a backgrounded dashboard doesn't keep hitting the API.
  const hasStatus = !!status;
  useEffect(() => {
    if (!installationId || !hasStatus) return;
    const POLL_MS = 5000;
    const tick = () => {
      if (document.visibilityState === 'visible') loadStatus(installationId, { silent: true });
    };
    const interval = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installationId, hasStatus]);

  const handleConnect = async () => {
    if (!tokenDraft.trim()) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch('/api/automation/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ githubToken: tokenDraft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setConnectError(data.error || 'Failed to connect');
        return;
      }
      saveInstallationId(data.installationId);
      setInstallationId(data.installationId);
      setTokenDraft('');
      await loadStatus(data.installationId);
    } catch (err) {
      setConnectError(err.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!installationId) return;
    setDisconnecting(true);
    try {
      await fetch('/api/automation/register', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId }),
      });
    } finally {
      saveInstallationId('');
      setInstallationId('');
      setStatus(null);
      setDisconnecting(false);
    }
  };

  const handleCopy = async () => {
    if (!status?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(status.webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleCopySecret = async () => {
    if (!status?.webhookSecret) return;
    try {
      await navigator.clipboard.writeText(status.webhookSecret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2000);
    } catch {}
  };

  const handleApprove = async (prUrl) => {
    setResolvingPr(prUrl);
    try {
      await fetch('/api/automation/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId, prUrl }),
      });
      // The actual commit happens once GitHub delivers the webhook for the
      // confirmation comment this just posted — not instant, so just drop
      // it from the list (and keep it hidden across polls, see
      // resolvedPrsRef) rather than waiting for a real outcome here.
      resolvedPrsRef.current.add(prUrl);
      setStatus((s) => (s ? { ...s, pendingApprovals: s.pendingApprovals.filter((p) => p.prUrl !== prUrl) } : s));
    } finally {
      setResolvingPr(null);
    }
  };

  const handleDismiss = async (prUrl) => {
    setResolvingPr(prUrl);
    try {
      await fetch('/api/automation/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId, prUrl }),
      });
      resolvedPrsRef.current.add(prUrl);
      setStatus((s) => (s ? { ...s, pendingApprovals: s.pendingApprovals.filter((p) => p.prUrl !== prUrl) } : s));
    } finally {
      setResolvingPr(null);
    }
  };

  return (
    <main className="card">
      <div className="section-title blue">AUTOMATION</div>

      {loadError && (
        <div className="error-block">
          <p>❌ Couldn&rsquo;t load automation status: {loadError}</p>
        </div>
      )}

      {loading && !loadError && (
        <div className="loading">
          <div className="spinner" />
          <p className="loading-text">LOADING STATUS...</p>
        </div>
      )}

      {!loading && !status && (
        <>
          <p className={styles.statusNote}>
            Connect your own GitHub account to auto-review new PRs on your repos and reply to comments on PRs
            you&rsquo;re assigned to or authored — this uses your token and your own webhook, so it works the same
            whether you deployed this instance or you&rsquo;re just a visitor using someone else&rsquo;s hosted copy.
            Nothing is shared with other users. Replies always propose first and wait for your confirmation before
            committing anything — you can confirm on GitHub or from the Pending Approvals list here.
          </p>
          <div className={styles.block}>
            <div className={styles.connectForm}>
              <input
                type="password"
                placeholder="GitHub token (repo scope)…"
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
              />
              <button type="button" className="btn btn-approve" onClick={handleConnect} disabled={connecting || !tokenDraft.trim()}>
                {connecting ? 'Connecting…' : 'Connect'}
              </button>
            </div>
            {connectError && <p className={styles.connectHint}>❌ {connectError}</p>}
          </div>
        </>
      )}

      {!loading && status && (
        <>
          <div className={styles.statusGrid}>
            <div className={styles.statusRow}>
              <span className={`${styles.statusDot} ${styles.statusOk}`} />
              <span className={styles.statusLabel}>Watching as</span>
              <span className={styles.statusValue}>{status.botLogin ? `@${status.botLogin}` : '—'}</span>
            </div>
          </div>

          {status.pendingApprovals.length > 0 && (
            <div className={styles.block}>
              <div className="section-title blue">PENDING APPROVALS</div>
              <p className={styles.statusNote}>
                A fix was proposed on these PRs and is waiting for your confirmation before anything is committed.
              </p>
              <div className={styles.activityList}>
                {status.pendingApprovals.map((item) => (
                  <div className={styles.block} key={item.prUrl}>
                    <a href={item.prUrl} target="_blank" rel="noreferrer" className={styles.activityLink}>
                      {prNumberOf(item.prUrl) ? `#${prNumberOf(item.prUrl)} ` : ''}
                      {item.prTitle || item.prUrl}
                    </a>
                    <pre className="review-recommendation">{item.preview}</pre>
                    <div className={styles.connectForm}>
                      <button
                        type="button"
                        className="btn btn-approve"
                        onClick={() => handleApprove(item.prUrl)}
                        disabled={resolvingPr === item.prUrl}
                      >
                        {resolvingPr === item.prUrl ? 'Working…' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => handleDismiss(item.prUrl)}
                        disabled={resolvingPr === item.prUrl}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={styles.block}>
            <div className="section-title blue">WEBHOOK URL</div>
            <p className={styles.statusNote}>This URL is unique to your connected account — don&rsquo;t share it.</p>
            <div className={styles.webhookRow}>
              <code className={styles.webhookUrl}>{status.webhookUrl}</code>
              <button type="button" className="btn btn-secondary" onClick={handleCopy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className={styles.block}>
            <div className="section-title blue">SETUP</div>
            <ol className={styles.setupSteps}>
              <li>On the repo you want watched: <strong>Settings → Webhooks → Add webhook</strong>.</li>
              <li>Payload URL: the webhook URL above.</li>
              <li>Content type: <code>application/json</code>.</li>
              <li>
                Secret: paste the value below into the GitHub webhook <strong>Secret</strong> field.
                <div className={styles.webhookRow}>
                  <code className={styles.webhookUrl}>{status.webhookSecret}</code>
                  <button type="button" className="btn btn-secondary" onClick={handleCopySecret}>
                    {secretCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </li>
              <li>Events: <strong>Issue comments</strong>, <strong>Pull request review comments</strong>, <strong>Pull request reviews</strong>, and <strong>Pull requests</strong> (for auto-review on open).</li>
            </ol>
          </div>

          <div className={styles.block}>
            <div className="section-title blue">RECENT ACTIVITY</div>
            {status.recentActivity.length === 0 ? (
              <div className="empty-state">
                No automated activity yet — a new PR on a watched repo gets auto-reviewed, and a comment on a PR
                you&rsquo;re assigned to or authored gets a reply. Both show up here.
              </div>
            ) : (
              <div className={styles.activityList}>
                {status.recentActivity.map((entry) => (
                  <div className={styles.activityRow} key={entry.id}>
                    <span className={`${styles.activityBadge} ${styles[ACTIVITY_BADGE_CLASS[entry.outcome]] || ''}`}>
                      {activityLabel(entry)}
                    </span>
                    <div className={styles.activityBody}>
                      {entry.prUrl ? (
                        <a href={entry.prUrl} target="_blank" rel="noreferrer" className={styles.activityLink}>
                          {prNumberOf(entry.prUrl) ? `#${prNumberOf(entry.prUrl)} ` : ''}
                          {entry.prTitle || entry.prUrl}
                        </a>
                      ) : (
                        <span className={styles.activityLink}>{entry.eventType || 'event'}</span>
                      )}
                      {entry.reason && <span className={styles.activityReason}>{entry.reason}</span>}
                      <span
                        className={styles.activityTime}
                        title={entry.deliveryId ? `GitHub delivery ${entry.deliveryId}` : undefined}
                      >
                        #{entry.id} · {new Date(entry.at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.block}>
            <button type="button" className={styles.disconnectBtn} onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect this account'}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
