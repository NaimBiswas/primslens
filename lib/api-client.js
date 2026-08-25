const API_BASE = '/api';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function postJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: 'Invalid server response' }));
  if (!res.ok) throw new ApiError(data.error || 'Request failed', res.status);
  return data;
}

/**
 * Reviews a PR, reporting real pipeline stages as they happen instead of
 * resolving only once with the final result. `onProgress`, if given, is
 * called as `onProgress({ stage, label })` for each stage the server reports
 * (fetching PR, pulling codebase tree, running AI review, ...).
 */
export async function reviewPR(prUrl, token, onProgress) {
  const res = await fetch(`${API_BASE}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prUrl, token }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Invalid server response' }));
    throw new ApiError(data.error || 'Request failed', res.status);
  }

  // Fall back to a plain JSON parse if the environment doesn't expose a
  // readable stream body (e.g. some older browsers) — the route still sends
  // valid NDJSON, so a whole-body JSON.parse of a single-line stream works.
  if (!res.body || !res.body.getReader) {
    const text = await res.text();
    return parseNdjson(text, onProgress);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const outcome = { result: undefined, errorMsg: undefined };
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      handleNdjsonLine(buffer.slice(0, newlineIndex), onProgress, outcome);
      buffer = buffer.slice(newlineIndex + 1);
    }
  }
  handleNdjsonLine(buffer, onProgress, outcome);

  if (outcome.errorMsg) throw new ApiError(outcome.errorMsg, 200);
  if (!outcome.result) throw new ApiError('Review stream ended without a result', 200);
  return outcome.result;
}

// Parses one NDJSON line, forwarding progress events to `onProgress` and
// recording the terminal result/error onto `outcome` in place.
function handleNdjsonLine(line, onProgress, outcome) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let evt;
  try { evt = JSON.parse(trimmed); } catch { return; }
  if (evt.type === 'progress') onProgress?.(evt);
  else if (evt.type === 'result') outcome.result = evt.data;
  else if (evt.type === 'error') outcome.errorMsg = evt.error || 'Review failed';
}

function parseNdjson(text, onProgress) {
  const outcome = { result: undefined, errorMsg: undefined };
  for (const line of text.split('\n')) handleNdjsonLine(line, onProgress, outcome);
  if (outcome.errorMsg) throw new ApiError(outcome.errorMsg, 200);
  if (!outcome.result) throw new ApiError('Review stream ended without a result', 200);
  return outcome.result;
}

export async function postReviewToPR(prUrl, token, review) {
  const data = await postJson('/review/post', { prUrl, token, review });
  return data;
}

export async function approvePR(prUrl, token, review) {
  return postJson('/review/post', { prUrl, token, review, event: 'APPROVE' });
}

export async function mergePR(prUrl, token, mergeMethod) {
  return postJson('/review/merge', { prUrl, token, mergeMethod });
}

export async function describePR(prUrl, token, review) {
  return postJson('/review/describe', { prUrl, token, review });
}

export async function labelPR(prUrl, token, review) {
  return postJson('/review/label', { prUrl, token, review });
}

export async function submitFeedback(prUrl, item, vote) {
  return postJson('/feedback', { prUrl, issue: item.issue, category: item.category, severity: item.severity, vote });
}

export async function postChatMessage(prUrl, token, review, message, history) {
  const data = await postJson('/chat', { prUrl, token, review, message, history });
  return data.content || '';
}
