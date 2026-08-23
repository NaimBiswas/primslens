'use client';

import { useState, useEffect } from 'react';
import styles from '../app/code-review/dashboard.module.css';

function formatContext(n) {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M context`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K context`;
  return `${n} context`;
}

export default function ModelPanel() {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    fetch('/api/model')
      .then((res) => res.json())
      .then(setState)
      .catch((err) => setLoadError(err.message));
  }, []);

  const select = async (modelId) => {
    setSaving(modelId ?? 'default');
    try {
      const res = await fetch('/api/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId }),
      });
      const data = await res.json();
      if (res.ok) setState((s) => ({ ...s, selected: data.selected }));
    } finally {
      setSaving(null);
    }
  };

  return (
    <main className="card">
      <div className="section-title blue">MODEL</div>

      {loadError && (
        <div className="error-block">
          <p>❌ Couldn&rsquo;t load models: {loadError}</p>
        </div>
      )}

      {!state && !loadError && (
        <div className="loading">
          <div className="spinner" />
          <p className="loading-text">LOADING MODELS...</p>
        </div>
      )}

      {state && !state.opencodeAvailable && (
        <div className="empty-state">
          opencode isn&rsquo;t installed, so there&rsquo;s no model to pick — analysis runs on the regex fallback instead.
          Install it with <code className="chat-inline-code">npm install -g opencode-ai</code> and reload this page.
        </div>
      )}

      {state && state.opencodeAvailable && (
        <>
          <p className={styles.statusNote}>
            All of these are opencode&rsquo;s own free models — no API key, no cost. Pick one to use for every
            review and chat run; you can change it anytime.
          </p>

          <div className={`${styles.modelList} ${styles.block}`}>
            <button
              type="button"
              className={`${styles.modelRow} ${!state.selected ? styles.modelRowActive : ''}`}
              onClick={() => select(null)}
              disabled={saving !== null}
            >
              <span className={`${styles.modelRadio} ${!state.selected ? styles.modelRadioActive : ''}`} />
              <span className={styles.modelInfo}>
                <span className={styles.modelName}>opencode default</span>
                <span className={styles.modelMeta}>whatever opencode itself is configured to use</span>
              </span>
              {!state.selected && <span className={styles.modelBadgeActive}>Active</span>}
            </button>

            {state.models.map((m) => {
              const active = state.selected === m.id;
              return (
                <button
                  type="button"
                  key={m.id}
                  className={`${styles.modelRow} ${active ? styles.modelRowActive : ''}`}
                  onClick={() => select(m.id)}
                  disabled={saving !== null}
                >
                  <span className={`${styles.modelRadio} ${active ? styles.modelRadioActive : ''}`} />
                  <span className={styles.modelInfo}>
                    <span className={styles.modelName}>{m.name}</span>
                    <span className={styles.modelMeta}>{m.id}{formatContext(m.context) ? ` · ${formatContext(m.context)}` : ''}</span>
                  </span>
                  {active && <span className={styles.modelBadgeActive}>Active</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
