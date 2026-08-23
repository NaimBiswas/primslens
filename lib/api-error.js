export function githubErrorResponse(err) {
  const status = err.response?.status || 500;
  const data = err.response?.data;
  const msg = data?.errors?.[0]?.message || data?.errors?.join?.(', ') || data?.message || err.message;
  return { status, msg };
}
