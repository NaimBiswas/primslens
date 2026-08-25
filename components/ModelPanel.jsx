'use client';

import { useState, useEffect, useMemo } from 'react';
import styles from '../app/code-review/dashboard.module.css';
import {
  getSavedGeminiKey,
  saveGeminiKey,
  getSavedGeminiModel,
  saveGeminiModel,
  getActiveModelSource,
  setActiveModelSource,
} from '../lib/gemini-local.js';

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

  // Own Gemini API key — a direct HTTPS call, not routed through opencode's
  // provider/credential system, so it's tracked separately. Stored in the
  // browser (see lib/gemini-local.js) rather than server-side, since a
  // server-side credential file wouldn't survive on serverless hosts.
  const [geminiKeyDraft, setGeminiKeyDraft] = useState('');
  const [geminiConnected, setGeminiConnected] = useState(false);
  const [geminiModels, setGeminiModels] = useState(null);
  const [geminiSelectedModel, setGeminiSelectedModel] = useState('');
  const [geminiConnecting, setGeminiConnecting] = useState(false);
  const [geminiError, setGeminiError] = useState(null);

  // Which backend the unified Models list below should treat as active —
  // '' means "no explicit choice made yet" (see gemini-local.js for how the
  // server interprets that). Set the moment the user clicks any model row.
  const [activeSource, setActiveSourceState] = useState('');
  const [modelSearch, setModelSearch] = useState('');

  const setActiveSource = (source) => {
    setActiveSourceState(source);
    setActiveModelSource(source);
  };

  const loadModels = () => fetch('/api/model').then((res) => res.json()).then(setState).catch((err) => setLoadError(err.message));
  const loadProviders = () => fetch('/api/providers').then((res) => res.json()).then((d) => setProviders(d.providers)).catch((err) => setProviderError(err.message));

  const fetchGeminiModels = async (apiKey) => {
    const res = await fetch('/api/gemini/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to validate key');
    return data.models;
  };

  useEffect(() => {
    loadModels();
    loadProviders();
    setActiveSourceState(getActiveModelSource());

    // Reconnect silently on load if a key was already saved, so the model
    // list (and validity of the key) is refreshed without another click.
    const savedKey = getSavedGeminiKey();
    if (savedKey) {
      setGeminiKeyDraft(savedKey);
      const savedModel = getSavedGeminiModel();
      if (savedModel) setGeminiSelectedModel(savedModel);
      fetchGeminiModels(savedKey)
        .then((models) => {
          setGeminiModels(models);
          setGeminiConnected(true);
          if (!savedModel && models.length) {
            const pick = models.find((m) => /flash/i.test(m.id)) || models[0];
            setGeminiSelectedModel(pick.id);
            saveGeminiModel(pick.id);
          }
        })
        .catch((err) => setGeminiError(err.message));
    }
  }, []);

  const connectGemini = async () => {
    if (!geminiKeyDraft.trim()) return;
    setGeminiConnecting(true);
    setGeminiError(null);
    try {
      const models = await fetchGeminiModels(geminiKeyDraft.trim());
      saveGeminiKey(geminiKeyDraft.trim());
      setGeminiModels(models);
      setGeminiConnected(true);
      const pick = models.find((m) => m.id === geminiSelectedModel) || models.find((m) => /flash/i.test(m.id)) || models[0];
      if (pick) {
        setGeminiSelectedModel(pick.id);
        saveGeminiModel(pick.id);
      }
    } catch (err) {
      setGeminiError(err.message);
      setGeminiConnected(false);
    } finally {
      setGeminiConnecting(false);
    }
  };

  const disconnectGemini = () => {
    saveGeminiKey('');
    saveGeminiModel('');
    setGeminiKeyDraft('');
    setGeminiConnected(false);
    setGeminiModels(null);
    setGeminiSelectedModel('');
    setGeminiError(null);
    if (activeSource === 'gemini') setActiveSource('');
  };

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

  // The single Models list at the bottom of the page: opencode's own free
  // models plus every connected provider's models (if opencode is
  // installed), and every model of a connected Gemini key — each row
  // labeled with where it comes from, so it reads as one list regardless of
  // how many backends are actually configured.
  const combinedModels = useMemo(() => {
    const list = [];
    if (state?.opencodeAvailable) {
      list.push({
        key: 'opencode-default',
        source: 'opencode',
        id: null,
        name: 'opencode default',
        meta: 'whatever opencode itself is configured to use',
        badge: 'OpenCode',
        free: true,
      });
      for (const m of state.models || []) {
        list.push({
          key: `oc-${m.id}`,
          source: 'opencode',
          id: m.id,
          name: m.name,
          meta: [formatContext(m.context), formatCost(m)].filter(Boolean).join(' · '),
          badge: m.providerName === 'opencode' ? 'OpenCode' : m.providerName,
          free: !!m.free,
        });
      }
    }
    if (geminiConnected && geminiModels) {
      for (const m of geminiModels) {
        list.push({
          key: `gem-${m.id}`,
          source: 'gemini',
          id: m.id,
          name: m.name,
          meta: [formatContext(m.inputTokenLimit), m.description].filter(Boolean).join(' · '),
          badge: 'Gemini',
          free: false,
        });
      }
    }
    return list;
  }, [state, geminiConnected, geminiModels]);

  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return combinedModels;
    return combinedModels.filter((m) => m.name.toLowerCase().includes(q) || m.badge.toLowerCase().includes(q));
  }, [combinedModels, modelSearch]);

  // No explicit pick yet defaults to whichever backend the server itself
  // would pick (Gemini if connected, else opencode) purely for highlighting
  // the right row — matches analyzePR's own fallback order in analyzer.js.
  const effectiveSource = activeSource || (geminiConnected ? 'gemini' : 'opencode');

  const isRowActive = (m) => {
    if (m.source !== effectiveSource) return false;
    return m.source === 'gemini' ? m.id === geminiSelectedModel : m.id === state?.selected;
  };

  const sourceBadgeClass = (m) => {
    if (m.source === 'gemini') return styles.modelSourceGemini;
    if (m.badge === 'OpenCode') return styles.modelSourceOpencode;
    return styles.modelSourceProvider;
  };

  const selectCombined = (m) => {
    if (m.source === 'gemini') {
      setGeminiSelectedModel(m.id);
      saveGeminiModel(m.id);
    } else {
      select(m.id);
    }
    setActiveSource(m.source);
  };

  return (
    <>
      <section className="card">
        <div className="section-title blue">GEMINI API KEY</div>
        <p className={styles.statusNote}>
          Use your own free Gemini key to power AI review directly — no opencode install required, and it works
          out of the box on serverless hosts. Get one at{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>.
          Stored in this browser only, sent with each review request. Pick which of its models to use in the Models
          section below.
        </p>

        <div className={styles.block}>
          <div className={styles.connectForm}>
            <input
              type="password"
              placeholder="Gemini API key…"
              value={geminiKeyDraft}
              onChange={(e) => setGeminiKeyDraft(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-approve"
              onClick={connectGemini}
              disabled={geminiConnecting || !geminiKeyDraft.trim()}
            >
              {geminiConnecting ? 'Validating…' : geminiConnected ? 'Reconnect' : 'Connect'}
            </button>
            {geminiConnected && (
              <button type="button" className={styles.disconnectBtn} onClick={disconnectGemini}>
                Disconnect
              </button>
            )}
          </div>
          {geminiError && <p className={styles.connectHint}>❌ {geminiError}</p>}
        </div>
      </section>

      <section className="card">
        <div className="section-title blue">PROVIDERS</div>
        <p className={styles.statusNote}>
          opencode can talk to any provider on its list — OpenAI, Anthropic, Google, Groq, and ~190 more. Connect one
          with its API key to add its models to the Models section below. Keys are stored by opencode itself, the
          same place <code className="chat-inline-code">opencode providers login</code> would put them — never sent
          anywhere else.
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

      <main className="card">
        <div className="section-title blue">MODELS</div>

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

        {state && !state.opencodeAvailable && !geminiConnected && (
          <div className="empty-state">
            No AI backend available yet — connect a Gemini key above, or install opencode with{' '}
            <code className="chat-inline-code">npm install -g opencode-ai</code> and reload this page. Analysis runs
            on the regex fallback until then.
          </div>
        )}

        {(state?.opencodeAvailable || geminiConnected) && (
          <>
            <p className={styles.statusNote}>
              Every model you can currently use, from every connected source — opencode&rsquo;s own free models, any
              provider you connected above, and your Gemini key&rsquo;s models. Each row shows where it comes from.
            </p>

            <div className={styles.block}>
              <input
                type="text"
                className={styles.modelSearch}
                placeholder="Search models…"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
              />
            </div>

            <div className={`${styles.modelList} ${styles.modelListScroll} ${styles.block}`}>
              {filteredModels.length === 0 && (
                <div className="empty-state">No model matches &ldquo;{modelSearch}&rdquo;.</div>
              )}
              {filteredModels.map((m) => {
                const active = isRowActive(m);
                return (
                  <button
                    type="button"
                    key={m.key}
                    className={`${styles.modelRow} ${active ? styles.modelRowActive : ''}`}
                    onClick={() => selectCombined(m)}
                    disabled={saving !== null}
                  >
                    <span className={`${styles.modelRadio} ${active ? styles.modelRadioActive : ''}`} />
                    <span className={styles.modelInfo}>
                      <span className={styles.modelName}>{m.name}</span>
                      {m.meta && <span className={styles.modelMeta}>{m.meta}</span>}
                    </span>
                    <span className={`${styles.modelSourceBadge} ${sourceBadgeClass(m)}`}>via {m.badge}</span>
                    {m.free && <span className={styles.modelBadgeFree}>Free</span>}
                    {active && <span className={styles.modelBadgeActive}>Active</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </main>
    </>
  );
}
