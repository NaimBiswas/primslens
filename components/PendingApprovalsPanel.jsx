'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import styles from '../app/code-review/dashboard.module.css';
import { getSavedInstallationId } from '../lib/automation-local.js';
import { prNumberOf } from '../lib/activity-format.js';

export default function PendingApprovalsPanel() {
  const [installationId, setInstallationId] = useState('');
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [resolvingPr, setResolvingPr] = useState(null);

  // PRs just approved/dismissed locally — kept hidden across polls until the
  // server actually stops listing them, since approve doesn't clear the row
  // instantly (it waits on a real webhook round trip for the confirmation
  // comment it just posted).
  const resolvedPrsRef = useRef(new Set());

  const applyPending = (list) => {
    const resolved = resolvedPrsRef.current;
    for (const prUrl of resolved) {
      if (!list.some((p) => p.prUrl === prUrl)) resolved.delete(prUrl);
    }
    setPendingApprovals(list.filter((p) => !resolved.has(p.prUrl)));
  };

  const loadPending = async (id, { silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const res = await fetch(`/api/automation/status?installationId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) return;
      applyPending(data.pendingApprovals || []);
    } catch (err) {
      if (!silent) setLoadError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    const saved = getSavedInstallationId();
    setInstallationId(saved);
    if (saved) loadPending(saved);
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!installationId) return;
    const tick = () => {
      if (document.visibilityState === 'visible') loadPending(installationId, { silent: true });
    };
    const interval = setInterval(tick, 5000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installationId]);

  const handleApprove = async (prUrl) => {
    setResolvingPr(prUrl);
    try {
      await fetch('/api/automation/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId, prUrl }),
      });
      resolvedPrsRef.current.add(prUrl);
      setPendingApprovals((list) => list.filter((p) => p.prUrl !== prUrl));
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
      setPendingApprovals((list) => list.filter((p) => p.prUrl !== prUrl));
    } finally {
      setResolvingPr(null);
    }
  };

  if (loading) {
    return (
      <main className={`card ${styles.tallCard}`}>
        <div className="loading">
          <div className="spinner" />
          <p className="loading-text">LOADING PENDING APPROVALS...</p>
        </div>
      </main>
    );
  }

  if (!installationId) {
    return (
      <main className={`card ${styles.tallCard}`}>
        <div className="section-title blue">PENDING APPROVALS</div>
        <div className="empty-state">
          No account connected yet — connect one on the <Link href="/automation">Automation page</Link> to see fixes
          waiting for your approval here.
        </div>
      </main>
    );
  }

  return (
    <main className={`card ${styles.tallCard}`}>
      {loadError && (
        <div className="error-block">
          <p>❌ Couldn&rsquo;t load pending approvals: {loadError}</p>
        </div>
      )}

      <div className="section-title blue">PENDING APPROVALS</div>

      {pendingApprovals.length === 0 ? (
        <div className="empty-state">
          Nothing waiting on you right now — a proposed fix shows up here as soon as it&rsquo;s waiting for your
          confirmation before anything is committed.
        </div>
      ) : (
        <>
          <p className={styles.statusNote}>
            A fix was proposed on {pendingApprovals.length === 1 ? 'this PR' : `these ${pendingApprovals.length} PRs`}{' '}
            and is waiting for your confirmation before anything is committed.
          </p>
          <div className={`${styles.activityList} ${styles.activityListScroll}`}>
            {pendingApprovals.map((item) => (
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
        </>
      )}
    </main>
  );
}
