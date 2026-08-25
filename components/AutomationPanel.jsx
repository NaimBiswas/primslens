'use client';

import { useState, useEffect } from 'react';
import styles from '../app/code-review/dashboard.module.css';
import { getSavedInstallationId, saveInstallationId } from '../lib/automation-local.js';

const ACTIVITY_BADGE_CLASS = {
  replied: 'activityReplied',
  skipped: 'activitySkipped',
  error: 'activityError',
};

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

  const loadStatus = async (id) => {
    setLoading(true);
    setLoadError(null);
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
      setStatus(data);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const saved = getSavedInstallationId();
    setInstallationId(saved);
    if (saved) loadStatus(saved);
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            Connect your own GitHub account to automate PR comment replies on your repos — this uses your token and
            your own webhook, so it works the same whether you deployed this instance or you&rsquo;re just a visitor
            using someone else&rsquo;s hosted copy. Nothing is shared with other users.
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
              <li>Events: <strong>Issue comments</strong>, <strong>Pull request review comments</strong>, and <strong>Pull request reviews</strong>.</li>
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
