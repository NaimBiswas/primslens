'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import styles from '../app/code-review/dashboard.module.css';
import { getSavedInstallationId } from '../lib/automation-local.js';
import { ACTIVITY_BADGE_CLASS, activityLabel, prNumberOf } from '../lib/activity-format.js';

export default function ActivityPanel() {
  const [installationId, setInstallationId] = useState('');
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const loadActivity = async (id, { silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const res = await fetch(`/api/automation/status?installationId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) return;
      setRecentActivity(data.recentActivity || []);
    } catch (err) {
      if (!silent) setLoadError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    const saved = getSavedInstallationId();
    setInstallationId(saved);
    if (saved) loadActivity(saved);
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same live-updating behavior as the Automation page — an event can land
  // at any time, not on a schedule this page controls.
  useEffect(() => {
    if (!installationId) return;
    const tick = () => {
      if (document.visibilityState === 'visible') loadActivity(installationId, { silent: true });
    };
    const interval = setInterval(tick, 5000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installationId]);

  const filteredActivity = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recentActivity.filter((entry) => {
      if (filter !== 'all' && entry.outcome !== filter) return false;
      if (!q) return true;
      const haystack = [entry.prTitle, entry.prUrl, activityLabel(entry), entry.reason, entry.eventType]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [recentActivity, search, filter]);

  if (loading) {
    return (
      <main className="card">
        <div className="loading">
          <div className="spinner" />
          <p className="loading-text">LOADING ACTIVITY...</p>
        </div>
      </main>
    );
  }

  if (!installationId) {
    return (
      <main className="card">
        <div className="section-title blue">RECENT ACTIVITY</div>
        <div className="empty-state">
          No account connected yet — connect one on the <Link href="/automation">Automation page</Link> to start
          seeing activity here.
        </div>
      </main>
    );
  }

  return (
    <main className="card">
      {loadError && (
        <div className="error-block">
          <p>❌ Couldn&rsquo;t load activity: {loadError}</p>
        </div>
      )}

      <div className="section-title blue">RECENT ACTIVITY</div>

      {recentActivity.length === 0 ? (
        <div className="empty-state">
          No automated activity yet — a new PR on a watched repo gets auto-reviewed, and a comment on a PR
          you&rsquo;re assigned to or authored gets a reply. Both show up here.
        </div>
      ) : (
        <>
          <div className={styles.connectForm}>
            <input
              type="text"
              placeholder="Search by PR, reason, event…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className={styles.activityFilterSelect} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All outcomes</option>
              <option value="received">Queued</option>
              <option value="replied">Replied</option>
              <option value="skipped">Skipped</option>
              <option value="error">Error</option>
            </select>
          </div>

          {filteredActivity.length === 0 ? (
            <div className="empty-state">No activity matches this search/filter.</div>
          ) : (
            <div className={`${styles.activityList} ${styles.activityListScroll}`}>
              {filteredActivity.map((entry) => (
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
        </>
      )}
    </main>
  );
}
