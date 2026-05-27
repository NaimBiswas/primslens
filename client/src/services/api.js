const API_BASE = '/api';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export async function reviewPR(prUrl, token) {
  const res = await fetch(`${API_BASE}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prUrl, token }),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || 'Review failed', res.status);
  return data;
}

export async function postReviewToPR(prUrl, token, review) {
  const res = await fetch(`${API_BASE}/review/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prUrl, token, review }),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || 'Failed to post review', res.status);
  return data;
}

export async function mergePR(prUrl, token, mergeMethod) {
  const res = await fetch(`${API_BASE}/review/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prUrl, token, mergeMethod }),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || 'Failed to merge PR', res.status);
  return data;
}
