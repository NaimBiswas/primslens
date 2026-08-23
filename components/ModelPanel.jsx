'use client';

import { useState, useEffect, useMemo } from 'react';
import styles from '../app/code-review/dashboard.module.css';

function formatContext(n) {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M context`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K context`;
  return `${n} context`;
}

function formatCost(m) {
  if (m.free) return 'free';
  if (!m.cost) return null;
  return `$${m.cost.input}/$${m.cost.output} per 1M tokens`;
}

export default function ModelPanel() {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(null);

  const [providers, setProviders] = useState(null);
  const [providerError, setProviderError] = useState(null);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);

  const loadModels = () => fetch('/api/model').then((res) => res.json()).then(setState).catch((err) => setLoadError(err.message));
  const loadProviders = () => fetch('/api/providers').then((res) => res.json()).then((d) => setProviders(d.providers)).catch((err) => setProviderError(err.message));

  useEffect(() => {
    loadModels();
    loadProviders();
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

  const connect = async (providerId) => {
    if (!apiKeyDraft.trim()) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, apiKey: apiKeyDraft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setConnectError(data.error || 'Failed to connect');
        return;
      }
      setApiKeyDraft('');
      setExpandedId(null);
      await Promise.all([loadModels(), loadProviders()]);
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async (providerId) => {
    setDisconnecting(providerId);
    try {
      await fetch('/api/providers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }),
      });
      await Promise.all([loadModels(), loadProviders()]);
    } finally {
      setDisconnecting(null);
    }
  };

  const connectedProviders = useMemo(() => (providers || []).filter((p) => p.configured), [providers]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !providers) return [];
    return providers.filter((p) => !p.configured && (p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))).slice(0, 12);
  }, [providers, query]);

  return (
    <>
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
              opencode&rsquo;s own models are always free — no API key, no cost. Connect a provider below (Providers
              section) to also pick from its models here; paid ones show their price per 1M tokens.
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
                const meta = [m.providerName, formatContext(m.context), formatCost(m)].filter(Boolean).join(' · ');
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
                      <span className={styles.modelMeta}>{meta}</span>
                    </span>
                    {active && <span className={styles.modelBadgeActive}>Active</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </main>

      <section className="card">
        <div className="section-title blue">PROVIDERS</div>
        <p className={styles.statusNote}>
          opencode can talk to any provider on its list — OpenAI, Anthropic, Google, Groq, and ~190 more. Connect one
          with its API key to add its models above. Keys are stored by opencode itself, the same place{' '}
          <code className="chat-inline-code">opencode providers login</code> would put them — never sent anywhere else.
        </p>

        {providerError && (
          <div className="error-block">
            <p>❌ Couldn&rsquo;t load providers: {providerError}</p>
          </div>
        )}

        {connectedProviders.length > 0 && (
          <div className={`${styles.connectedList} ${styles.block}`}>
            {connectedProviders.map((p) => (
              <span className={styles.connectedChip} key={p.id}>
                {p.name}
                <button
                  type="button"
                  className={styles.disconnectBtn}
                  onClick={() => disconnect(p.id)}
                  disabled={disconnecting !== null}
                >
                  {disconnecting === p.id ? '…' : 'Disconnect'}
                </button>
              </span>
            ))}
          </div>
        )}

        <div className={styles.block}>
          <input
            type="text"
            className={styles.providerSearch}
            placeholder="Search providers (e.g. openai, anthropic, groq)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {query.trim() && (
            <div className={`${styles.providerList} ${styles.block}`}>
              {searchResults.length === 0 && (
                <div className="empty-state">No provider matches &ldquo;{query}&rdquo;.</div>
              )}
              {searchResults.map((p) => (
                <div className={styles.providerRow} key={p.id}>
                  <div className={styles.providerRowHead}>
                    <span className={styles.providerInfo}>
                      <span className={styles.providerName}>{p.name}</span>
                      <span className={styles.providerMeta}>
                        {p.modelCount} model{p.modelCount === 1 ? '' : 's'} · needs {p.envVars[0] || 'an API key'}
                        {p.doc && <> · <a href={p.doc} target="_blank" rel="noreferrer">docs</a></>}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => { setExpandedId(expandedId === p.id ? null : p.id); setConnectError(null); setApiKeyDraft(''); }}
                    >
                      {expandedId === p.id ? 'Cancel' : 'Connect'}
                    </button>
                  </div>

                  {expandedId === p.id && (
                    <div className={styles.connectForm}>
                      <input
                        type="password"
                        placeholder={`${p.envVars[0] || 'API key'}…`}
                        value={apiKeyDraft}
                        onChange={(e) => setApiKeyDraft(e.target.value)}
                        autoFocus
                      />
                      <button type="button" className="btn btn-approve" onClick={() => connect(p.id)} disabled={connecting || !apiKeyDraft.trim()}>
                        {connecting ? 'Saving…' : 'Save'}
                      </button>
                      {connectError && <p className={styles.connectHint}>❌ {connectError}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
