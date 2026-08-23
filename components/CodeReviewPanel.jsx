'use client';

import { useState, useEffect } from 'react';
import { reviewPR, postReviewToPR, approvePR, mergePR } from '../lib/api-client.js';
import ChatPanel from './ChatPanel.jsx';

const TOKEN_KEY = 'PRISMLENS_TOKEN';

function getSavedToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

function saveToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

function esc(s) {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CATEGORIES = [
  { key: 'performance', icon: '⚡', label: 'Performance' },
  { key: 'security', icon: '🔒', label: 'Security' },
  { key: 'readability', icon: '📖', label: 'Readability' },
  { key: 'bugs_cat', icon: '🐛', label: 'Bugs' },
  { key: 'scalability', icon: '📊', label: 'Scalability' },
  { key: 'best_practices', icon: '✅', label: 'Best Practices' },
];

const SEVERITY_CLASSES = {
  critical: 'sev-critical',
  high: 'sev-high',
  medium: 'sev-medium',
  low: 'sev-low',
};

const TYPE_LABELS = {
  BUG: 'Bug',
  CONCERN: 'Concern',
  STRENGTH: 'Strength',
  INFO: 'Info',
};

function statusClass(state) {
  if (state === 'Merged') return 'green';
  if (state === 'Closed') return 'red';
  return '';
}

export default function CodeReviewPanel() {
  const [prUrl, setPrUrl] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState(null);
  const [postSuccess, setPostSuccess] = useState(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState(null);
  const [approveSuccess, setApproveSuccess] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState(null);
  const [mergeSuccess, setMergeSuccess] = useState(null);

  // Loaded after mount (not in the initial state) so the server-rendered
  // markup and the first client render match — localStorage doesn't exist
  // during SSR, so reading it in a useState initializer would mismatch.
  useEffect(() => {
    setToken(getSavedToken());
  }, []);

const handleSubmit = async (e) => {
  e.preventDefault();
  if (!prUrl.trim()) return setError('Enter a PR URL');
  if (!token.trim()) return setError('Enter a GitHub token');

  saveToken(token.trim());
  setLoading(true);
  setError(null);
  setResult(null);

  try {
    const data = await reviewPR(prUrl.trim(), token.trim());
    setResult(data);
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
};

  const handleApprove = async () => {
    if (!prUrl.trim() || !token.trim() || !result) return;
    setApproving(true);
    setApproveError(null);
    setApproveSuccess(null);
    try {
      const data = await approvePR(prUrl.trim(), token.trim(), result);
      setApproveSuccess(data.html_url || 'Approved');
    } catch (err) {
      setApproveError(err.message);
    } finally {
      setApproving(false);
    }
  };

  const handleMerge = async () => {
    if (!prUrl.trim() || !token.trim()) return;
    if (!window.confirm(`Merge this pull request?\n\n${result?.meta?.prTitle || prUrl}`)) return;
    setMerging(true);
    setMergeError(null);
    setMergeSuccess(null);
    try {
      const data = await mergePR(prUrl.trim(), token.trim());
      setMergeSuccess(data.message || 'Pull request merged');
    } catch (err) {
      setMergeError(err.message);
    } finally {
      setMerging(false);
    }
  };

  const handlePostToPR = async () => {
    if (!prUrl.trim() || !token.trim() || !result) return;
    setPosting(true);
    setPostError(null);
    setPostSuccess(null);
    try {
      const data = await postReviewToPR(prUrl.trim(), token.trim(), result);
      setPostSuccess(data.html_url || `Review #${data.id} posted`);
    } catch (err) {
      setPostError(err.message);
    } finally {
      setPosting(false);
    }
  };

  const handleReset = () => {
    setResult(null);
    setError(null);
    setPostSuccess(null);
    setPostError(null);
    setApproveSuccess(null);
    setApproveError(null);
    setMergeSuccess(null);
    setMergeError(null);
    setLoading(false);
  };

  const handleTokenChange = (e) => {
    setToken(e.target.value);
    saveToken(e.target.value);
  };

  const rec = result?.recommendation;
  const recClass = rec?.verdict === 'APPROVE' ? 'approve'
    : rec?.verdict === 'REVIEW' ? 'review'
    : rec?.verdict === 'REJECT' ? 'reject' : '';

  return (
    <>
      <main className="card">
        {!result && !loading && (
          <form id="inputForm" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="prUrl">PR URL</label>
              <input
                id="prUrl"
                type="url"
                placeholder="https://github.com/user/repo/pull/17"
                value={prUrl}
                onChange={(e) => setPrUrl(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="token">GitHub Token</label>
              <input
                id="token"
                type="text"
                placeholder="ghp_xxxxxx"
                value={token}
                onChange={handleTokenChange}
              />
              <small className="hint">
                Stored locally. Get one at{' '}
                <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">github.com/settings/tokens</a>
              </small>
            </div>
            <button type="submit" className="btn">🔍 Review PR</button>
          </form>
        )}

        {loading && (
          <div className="loading">
            <div className="spinner" />
            <p className="loading-text">ANALYZING CODE CHANGES...</p>
            <small>Fetching PR • Checking performance • Security scan • Readability • Bug detection • Scalability • Best practices</small>
          </div>
        )}

        {error && !loading && (
          <div className="error-block">
            <p>❌ {esc(error)}</p>
            <button className="btn btn-secondary" onClick={handleReset}>Try Again</button>
          </div>
        )}

        {result && !loading && (
          <>
            <div className="section-title blue">
              PR INFO
              {result.meta?.analysisMode && (
                <span className={`mode-badge mode-${result.meta.analysisMode}`}>
                  {result.meta.analysisMode === 'ai' ? 'AI ANALYSIS' : 'REGEX FALLBACK'}
                </span>
              )}
            </div>
            <div className="pr-info">
              {[
                { label: 'Title', value: result.meta?.prTitle, cls: '' },
                { label: 'Author', value: result.meta?.prAuthor, cls: '' },
                { label: 'Status', value: result.meta?.state, cls: statusClass(result.meta?.state) },
                { label: 'Assigned To', value: (result.meta?.assignees ?? []).join(', ') || 'Unassigned', cls: '' },
                { label: 'Files', value: result.meta?.stats?.filesChanged, cls: '' },
                { label: 'Added', value: `+${result.meta?.stats?.additions}`, cls: 'green' },
                { label: 'Deleted', value: `-${result.meta?.stats?.deletions}`, cls: 'red' },
              ].map((item) => (
                <div className="info-card" key={item.label}>
                  <h3>{item.label}</h3>
                  <p className={item.cls}>{item.value ?? '-'}</p>
                </div>
              ))}
            </div>

            <div className="section-title blue">CATEGORY OVERVIEW</div>
            <div className="category-overview">
              {CATEGORIES.map((cat) => {
                const items = result[cat.key] || [];
                if (!items.length) return null;
                const bugs = items.filter((i) => i.type === 'BUG').length;
                const concerns = items.filter((i) => i.type === 'CONCERN').length;
                return (
                  <div className={`cat-badge ${bugs ? 'cat-bad' : concerns ? 'cat-warn' : 'cat-good'}`} key={cat.key}>
                    <span className="cat-icon">{cat.icon}</span>
                    <span className="cat-label">{cat.label}</span>
                    <span className="cat-count">{items.length}</span>
                  </div>
                );
              })}
            </div>

            <div className="scroll-container">
              {CATEGORIES.map((cat) => {
                const items = result[cat.key] || [];
                if (!items.length) return null;
                return (
                  <CategorySection
                    key={cat.key}
                    icon={cat.icon}
                    title={cat.label}
                    items={items}
                  />
                );
              })}

              {CATEGORIES.every((cat) => !(result[cat.key] || []).length) && (
                <div className="empty-state">No review findings.</div>
              )}
            </div>

            <div className={`recommendation-box ${recClass}`}>
              <h3>{rec?.label || 'PENDING'}</h3>
              <p>{rec?.reason || ''}</p>
            </div>

            <div className="file-list">
              <div className="section-title blue">FILE CHANGES</div>
              {(result.files ?? []).length === 0 ? (
                <div className="empty-state">No file changes found.</div>
              ) : (
                result.files.map((f) => <FileDiffItem key={f.name} file={f} />)
              )}
            </div>

            <div className="post-section">
              <div className="btn-group">
                <button className="btn btn-comment" onClick={handlePostToPR} disabled={posting}>
                  {posting ? 'Posting...' : 'Comment'}
                </button>
                {rec?.verdict === 'APPROVE' && (
                  <button className="btn btn-approve" onClick={handleApprove} disabled={approving}>
                    {approving ? 'Approving...' : 'Approve'}
                  </button>
                )}
                {rec?.verdict === 'APPROVE' && (
                  <button className="btn btn-merge" onClick={handleMerge} disabled={merging}>
                    {merging ? 'Merging...' : 'Merge'}
                  </button>
                )}
                <button className="btn btn-chat" onClick={() => setChatOpen(true)}>Chat</button>
                <button className="btn btn-secondary" onClick={handleReset}>New Review</button>
              </div>
              {postError && <p className="post-error">{esc(postError)}</p>}
              {postSuccess && (
                <p className="post-success">
                  Comment posted. <a href={postSuccess} target="_blank" rel="noreferrer">View on GitHub</a>
                </p>
              )}
              {approveError && <p className="post-error">{esc(approveError)}</p>}
              {approveSuccess && (
                <p className="post-success">
                  Approved. <a href={approveSuccess} target="_blank" rel="noreferrer">View on GitHub</a>
                </p>
              )}
              {mergeError && <p className="post-error">{esc(mergeError)}</p>}
              {mergeSuccess && (
                <p className="post-success">{mergeSuccess}</p>
              )}
            </div>
          </>
        )}
      </main>

      {result && chatOpen && (
        <ChatPanel
          prUrl={prUrl.trim()}
          token={token.trim()}
          review={result}
          onClose={() => setChatOpen(false)}
        />
      )}

      {result && !chatOpen && (
        <button className="chat-toggle" onClick={() => setChatOpen(true)} title="Open Chat">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="chat-toggle-badge">!</span>
        </button>
      )}
    </>
  );
}

function FileDiffItem({ file }) {
  const [open, setOpen] = useState(false);
  const hasPatch = !!file.patch;

  return (
    <div className="file-item-wrap">
      <button
        type="button"
        className={`file-item ${hasPatch ? 'file-item-clickable' : ''}`}
        onClick={() => hasPatch && setOpen((v) => !v)}
        disabled={!hasPatch}
      >
        <span className="file-name">{hasPatch ? (open ? '▾ ' : '▸ ') : ''}{esc(file.name)}</span>
        <div className="file-stats">
          <span className="stat-add">+{file.additions || 0}</span>
          <span className="stat-del">-{file.deletions || 0}</span>
        </div>
      </button>
      {open && hasPatch && (
        <pre className="file-patch">
          {file.patch.split('\n').map((line, i) => {
            const cls = line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : 'diff-ctx';
            return <div className={cls} key={i}>{line}</div>;
          })}
        </pre>
      )}
    </div>
  );
}

function sevClass(severity) {
  return SEVERITY_CLASSES[severity] || '';
}

function CategorySection({ icon, title, items }) {
  return (
    <>
      <div className="section-title category-title">{icon} {title} <span className="cat-section-count">{items.length}</span></div>
      {items.map((item, i) => (
        <div className={`review-item sev-${item.severity || 'low'}`} key={i}>
          <div className="review-header">
            <div className="review-left">
              <span className={`sev-dot ${sevClass(item.severity)}`} />
              <span className="review-title">{esc(item.issue)}</span>
            </div>
            <div className="review-meta">
              <span className={`sev-badge ${sevClass(item.severity)}`}>{item.severity}</span>
              <span className="type-badge">{TYPE_LABELS[item.type] || item.type}</span>
            </div>
          </div>
          {item.file && <div className="review-file">{esc(item.file)}</div>}
          {item.recommendation && (
            <div className="review-recommendation">{esc(item.recommendation)}</div>
          )}
        </div>
      ))}
    </>
  );
}
