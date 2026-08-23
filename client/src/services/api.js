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

export async function reviewPR(prUrl, token) {
  return postJson('/review', { prUrl, token });
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

export async function postChatMessage(prUrl, token, review, message, history) {
  const data = await postJson('/chat', { prUrl, token, review, message, history });
  return data.content || '';
}
