'use client';

import { useState, useEffect, useMemo } from 'react';
import styles from '../app/code-review/dashboard.module.css';
import {
  getSavedKey,
  saveKey,
  getActiveBackend,
  setActiveBackend,
  clearActiveBackendIfProvider,
} from '../lib/ai-local.js';

// Distinct color per provider for the Models list's source badge — not tied
// to the app's fixed neon-* palette since there are more providers than
// spare hues, so these are picked directly rather than reusing CSS vars.
const PROVIDER_COLORS = {
  gemini: '#ff2a6d',
  openai: '#05d9e8',
  anthropic: '#b137fc',
  groq: '#ff9f43',
  openrouter: '#4dd0e1',
  mistral: '#ff6b6b',
  deepseek: '#7c83fd',
};

function badgeStyle(providerId) {
  const color = PROVIDER_COLORS[providerId] || '#9aa0b4';
  return { color, background: `${color}1a`, borderColor: `${color}4d` };
}

// A cheap/fast model is a sensible default the first time a provider
// connects — a user who hasn't picked one yet gets something reasonable
// rather than accidentally landing on the most expensive option.
function pickDefaultModel(models) {
  return models.find((m) => /flash|mini|haiku|small|8b|lite/i.test(m.id)) || models[0];
}

export default function ModelPanel() {
  const [providerDefs, setProviderDefs] = useState([]);
  const [keyDrafts, setKeyDrafts] = useState({});
  const [connected, setConnected] = useState({}); // { [providerId]: models[] }
  const [connecting, setConnecting] = useState(null);
  const [errors, setErrors] = useState({});
  const [active, setActive] = useState(null); // { providerId, model }
  const [modelSearch, setModelSearch] = useState('');

  const validateProvider = async (providerId, apiKey, { silent } = {}) => {
    if (!silent) setConnecting(providerId);
    setErrors((e) => ({ ...e, [providerId]: null }));
    try {
      const res = await fetch('/api/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to validate key');

      saveKey(providerId, apiKey);
      setConnected((c) => ({ ...c, [providerId]: data.models }));

      if (!getActiveBackend()?.providerId && data.models.length) {
        const pick = pickDefaultModel(data.models);
        setActiveBackend(providerId, pick.id);
        setActive({ providerId, model: pick.id });
      }
    } catch (err) {
      setErrors((e) => ({ ...e, [providerId]: err.message }));
      setConnected((c) => {
        const next = { ...c };
        delete next[providerId];
        return next;
      });
    } finally {
      if (!silent) setConnecting(null);
    }
  };

  useEffect(() => {
    setActive(getActiveBackend());
    fetch('/api/ai/models')
      .then((res) => res.json())
      .then((data) => {
        const defs = data.providers || [];
        setProviderDefs(defs);
        for (const p of defs) {
          const saved = getSavedKey(p.id);
          if (saved) {
            setKeyDrafts((d) => ({ ...d, [p.id]: saved }));
            validateProvider(p.id, saved, { silent: true });
          }
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectProvider = (providerId) => {
    const apiKey = (keyDrafts[providerId] || '').trim();
    if (!apiKey) return;
    validateProvider(providerId, apiKey);
  };

  const disconnectProvider = (providerId) => {
    saveKey(providerId, '');
    setConnected((c) => {
      const next = { ...c };
      delete next[providerId];
      return next;
    });
    setKeyDrafts((d) => ({ ...d, [providerId]: '' }));
    clearActiveBackendIfProvider(providerId);
    setActive((a) => (a?.providerId === providerId ? null : a));
  };

  const combinedModels = useMemo(() => {
    const list = [];
    for (const p of providerDefs) {
      const models = connected[p.id];
      if (!models) continue;
      for (const m of models) {
        list.push({
          key: `${p.id}-${m.id}`,
          providerId: p.id,
          providerName: p.name,
          id: m.id,
          name: m.name,
          meta: m.meta,
          free: !!m.free,
        });
      }
    }
    return list;
  }, [providerDefs, connected]);

  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return combinedModels;
    return combinedModels.filter((m) => m.name.toLowerCase().includes(q) || m.providerName.toLowerCase().includes(q));
  }, [combinedModels, modelSearch]);

  const isRowActive = (m) => active?.providerId === m.providerId && active?.model === m.id;

  const selectCombined = (m) => {
    setActiveBackend(m.providerId, m.id);
    setActive({ providerId: m.providerId, model: m.id });
  };

  const anyConnected = Object.keys(connected).length > 0;

  return (
    <>
      <section className="card">
        <div className="section-title blue">AI PROVIDERS</div>
        <p className={styles.statusNote}>
          Connect any of these with your own API key to power AI review and chat — each is a direct HTTPS call, no
          CLI or install required, so it works the same locally and on a hosted deployment. Keys are stored in this
          browser only, sent with each request.
        </p>

        <div className={`${styles.providerList} ${styles.block}`}>
          {providerDefs.map((p) => {
            const isConnected = !!connected[p.id];
            return (
              <div className={styles.providerRow} key={p.id}>
                <div className={styles.providerRowHead}>
                  <span className={styles.providerInfo}>
                    <span className={styles.providerName}>{p.name}</span>
                    <span className={styles.providerMeta}>
                      {isConnected ? `${connected[p.id].length} model(s) available` : 'Not connected'} ·{' '}
                      <a href={p.docsUrl} target="_blank" rel="noreferrer">get a key</a>
                    </span>
                  </span>
                  {isConnected && (
                    <button type="button" className={styles.disconnectBtn} onClick={() => disconnectProvider(p.id)}>
                      Disconnect
                    </button>
                  )}
                </div>

                <div className={styles.connectForm}>
                  <input
                    type="password"
                    placeholder={p.keyPlaceholder || 'API key…'}
                    value={keyDrafts[p.id] || ''}
                    onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn btn-approve"
                    onClick={() => connectProvider(p.id)}
                    disabled={connecting === p.id || !(keyDrafts[p.id] || '').trim()}
                  >
                    {connecting === p.id ? 'Validating…' : isConnected ? 'Reconnect' : 'Connect'}
                  </button>
                </div>
                {errors[p.id] && <p className={styles.connectHint}>❌ {errors[p.id]}</p>}
              </div>
            );
          })}
        </div>
      </section>

      <main className="card">
        <div className="section-title blue">MODELS</div>

        {!anyConnected && (
          <div className="empty-state">
            No AI backend available yet — connect a provider above to enable AI review and chat. Analysis runs on
            the regex fallback until then.
          </div>
        )}

        {anyConnected && (
          <>
            <p className={styles.statusNote}>
              Every model from every connected provider, in one searchable list. Pick one to use it for review and
              chat.
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
                const isActive = isRowActive(m);
                return (
                  <button
                    type="button"
                    key={m.key}
                    className={`${styles.modelRow} ${isActive ? styles.modelRowActive : ''}`}
                    onClick={() => selectCombined(m)}
                  >
                    <span className={`${styles.modelRadio} ${isActive ? styles.modelRadioActive : ''}`} />
                    <span className={styles.modelInfo}>
                      <span className={styles.modelName}>{m.name}</span>
                      {m.meta && <span className={styles.modelMeta}>{m.meta}</span>}
                    </span>
                    <span className={styles.modelSourceBadge} style={badgeStyle(m.providerId)}>via {m.providerName}</span>
                    {m.free && <span className={styles.modelBadgeFree}>Free</span>}
                    {isActive && <span className={styles.modelBadgeActive}>Active</span>}
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
