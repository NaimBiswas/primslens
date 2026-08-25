'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import styles from '../app/code-review/dashboard.module.css';
import { getSavedInstallationId, saveInstallationId } from '../lib/automation-local.js';
import { resolveAIOverride } from '../lib/ai-local.js';
import { POLL_MS } from '../lib/automation-poll.js';

// Matches the provider registry in lib/services/ai-providers.js — just
// enough to label the automation status line, so it doesn't need a network
// round trip to /api/ai/models just to find a display name.
const PROVIDER_NAME = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
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
  const [savingAIConfig, setSavingAIConfig] = useState(false);
  const [aiConfigError, setAiConfigError] = useState(null);

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
      setStatus(data);
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
    setConnectError(null);
    try {
      const res = await fetch('/api/automation/register', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setConnectError(data.error || 'Failed to disconnect');
        return;
      }
      saveInstallationId('');
      setInstallationId('');
      setStatus(null);
    } catch (err) {
      setConnectError(err.message);
    } finally {
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

  // Whatever's currently active on the Model page in *this* browser — null
  // if nothing's configured there. Automation can't see localStorage on its
  // own (it runs server-side, triggered by a webhook), so this has to be
  // pushed to the server explicitly rather than picked up automatically.
  const myActiveProvider = resolveAIOverride();

  // Shared body for the two AI-config POSTs below — both flip the same
  // "use this provider for automation" bit, the only difference is whether
  // they spread the caller's active provider or omit it (to fall back to
  // the server default). Keeping the fetch/error/reload flow in one place
  // is what stops the two paths from drifting the next time one is edited.
  const saveAIConfig = async (body) => {
    setSavingAIConfig(true);
    setAiConfigError(null);
    try {
      const res = await fetch('/api/automation/ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId, ...body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAiConfigError(data.error || 'Failed to save AI provider');
        return;
      }
      await loadStatus(installationId);
    } finally {
      setSavingAIConfig(false);
    }
  };

  const handleUseMyProvider = async () => {
    if (!myActiveProvider) return;
    return saveAIConfig(myActiveProvider);
  };

  const handleUseServerDefault = async () => {
    return saveAIConfig({});
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
            committing anything — you can confirm on GitHub or from the Pending Approvals page.
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
            <div className="section-title blue">AI PROVIDER FOR AUTOMATION</div>
            {aiConfigError && (
              <p className={styles.connectHint}>❌ {aiConfigError}</p>
            )}
            {status.aiProviderId ? (
              <>
                <p className={styles.statusNote}>
                  Automated replies and reviews use <strong>{PROVIDER_NAME[status.aiProviderId] || status.aiProviderId}</strong>
                  {status.aiModel ? ` (${status.aiModel})` : ''} — your own key, not the server&rsquo;s default.
                </p>
                <button type="button" className="btn btn-secondary" onClick={handleUseServerDefault} disabled={savingAIConfig}>
                  {savingAIConfig ? 'Working…' : 'Use server default instead'}
                </button>
              </>
            ) : (
              <>
                <p className={styles.statusNote}>
                  Automation is using whichever provider the server has an env key for — not necessarily the one you
                  picked on the Model page.
                </p>
                <button
                  type="button"
                  className="btn btn-approve"
                  onClick={handleUseMyProvider}
                  disabled={savingAIConfig || !myActiveProvider}
                >
                  {savingAIConfig
                    ? 'Working…'
                    : myActiveProvider
                      ? `Use my ${PROVIDER_NAME[myActiveProvider.providerId] || myActiveProvider.providerId} for automation`
                      : 'Configure a provider on the Model page first'}
                </button>
              </>
            )}
          </div>

          <div className={styles.block}>
            <div className="section-title blue">PENDING APPROVALS</div>
            <p className={styles.statusNote}>
              {status.pendingApprovals.length === 0
                ? 'Nothing waiting on you right now.'
                : `${status.pendingApprovals.length} fix${status.pendingApprovals.length === 1 ? '' : 'es'} waiting for your confirmation.`}
              {' '}
              <Link href="/pending-approvals">Review &amp; approve →</Link>
            </p>
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
              <li>Events: <strong>Issue comments</strong>, <strong>Pull request review comments</strong>, <strong>Pull request reviews</strong>, and <strong>Pull requests</strong> (for auto-review on open).</li>
            </ol>
          </div>

          <div className={styles.block}>
            <div className="section-title blue">RECENT ACTIVITY</div>
            <p className={styles.statusNote}>
              {status.recentActivity.length === 0
                ? "No automated activity yet — a new PR on a watched repo gets auto-reviewed, and a comment on a PR you're assigned to or authored gets a reply."
                : `${status.recentActivity.length} recent event${status.recentActivity.length === 1 ? '' : 's'} recorded.`}
              {' '}
              <Link href="/activity">View full activity, with search &amp; filters →</Link>
            </p>
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
