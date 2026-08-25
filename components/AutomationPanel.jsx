'use client';

import { useState, useEffect } from 'react';
import styles from '../app/code-review/dashboard.module.css';

const ACTIVITY_BADGE_CLASS = {
  replied: 'activityReplied',
  skipped: 'activitySkipped',
  error: 'activityError',
};

export default function AutomationPanel() {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/automation/status')
      .then((res) => res.json())
      .then(setStatus)
      .catch((err) => setLoadError(err.message));
  }, []);

  const handleCopy = async () => {
    if (!status?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(status.webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const [secretCopied, setSecretCopied] = useState(false);
  const handleCopySecret = async () => {
    if (!status?.webhookSecret) return;
    try {
      await navigator.clipboard.writeText(status.webhookSecret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2000);
    } catch {}
  };

  const ready = status?.tokenConfigured && status?.webhookSecretConfigured;

  return (
    <main className="card">
      <div className="section-title blue">AUTOMATION STATUS</div>

      {loadError && (
        <div className="error-block">
          <p>❌ Couldn&rsquo;t load automation status: {loadError}</p>
        </div>
      )}

      {!status && !loadError && (
        <div className="loading">
          <div className="spinner" />
          <p className="loading-text">LOADING STATUS...</p>
        </div>
      )}

      {status && (
        <>
          <div className={styles.statusGrid}>
            <div className={styles.statusRow}>
              <span className={`${styles.statusDot} ${status.tokenConfigured ? styles.statusOk : styles.statusMissing}`} />
              <span className={styles.statusLabel}>GITHUB_TOKEN</span>
              <span className={styles.statusValue}>{status.tokenConfigured ? 'Configured' : 'Not set'}</span>
            </div>
            <div className={styles.statusRow}>
              <span className={`${styles.statusDot} ${status.webhookSecretConfigured ? styles.statusOk : styles.statusMissing}`} />
              <span className={styles.statusLabel}>GITHUB_WEBHOOK_SECRET</span>
              <span className={styles.statusValue}>{status.webhookSecretConfigured ? 'Configured' : 'Not set'}</span>
            </div>
            <div className={styles.statusRow}>
              <span className={`${styles.statusDot} ${status.botLogin ? styles.statusOk : styles.statusMissing}`} />
              <span className={styles.statusLabel}>Watching as</span>
              <span className={styles.statusValue}>{status.botLogin ? `@${status.botLogin}` : '—'}</span>
            </div>
          </div>

          {!ready && (
            <p className={styles.statusNote}>
              Set both env vars above (see Setup below) to turn automation on. Nothing runs — and no comment is ever read — until both are configured.
            </p>
          )}

          <div className={styles.block}>
            <div className="section-title blue">WEBHOOK URL</div>
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
                {status.webhookSecret ? (
                  <div className={styles.webhookRow}>
                    <code className={styles.webhookUrl}>{status.webhookSecret}</code>
                    <button type="button" className="btn btn-secondary" onClick={handleCopySecret}>
                      {secretCopied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ) : (
                  <p className={styles.statusNote}>
                    {status.webhookSecretConfigured
                      ? 'Set, but hidden here for security — copy it from your GITHUB_WEBHOOK_SECRET env var directly.'
                      : 'Not set yet — add GITHUB_WEBHOOK_SECRET to your env vars first.'}
                  </p>
                )}
              </li>
              <li>Events: <strong>Issue comments</strong> and <strong>Pull request review comments</strong>.</li>
            </ol>
          </div>

          <div className={styles.block}>
            <div className="section-title blue">RECENT ACTIVITY</div>
            {status.recentActivity.length === 0 ? (
              <div className="empty-state">
                No automated replies yet — once a comment lands on a PR you&rsquo;re assigned to or authored, it&rsquo;ll show up here.
              </div>
            ) : (
              <div className={styles.activityList}>
                {status.recentActivity.map((entry, i) => (
                  <div className={styles.activityRow} key={i}>
                    <span className={`${styles.activityBadge} ${styles[ACTIVITY_BADGE_CLASS[entry.outcome]] || ''}`}>
                      {entry.outcome}
                    </span>
                    <div className={styles.activityBody}>
                      <a href={entry.prUrl} target="_blank" rel="noreferrer" className={styles.activityLink}>
                        {entry.prTitle || entry.prUrl}
                      </a>
                      {entry.reason && <span className={styles.activityReason}>{entry.reason}</span>}
                      <span className={styles.activityTime}>{new Date(entry.at).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
