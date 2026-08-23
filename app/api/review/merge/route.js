import { NextResponse } from 'next/server';
import { mergePR } from '../../../../lib/services/github.js';
import { githubErrorResponse } from '../../../../lib/api-error.js';

export const runtime = 'nodejs';

/**
 * POST /api/review/merge
 * Body: { prUrl, token, mergeMethod? }
 * Merges the pull request
 */
export async function POST(req) {
  const { prUrl, token, mergeMethod } = await req.json();

  if (!prUrl) return NextResponse.json({ error: 'prUrl is required' }, { status: 400 });
  if (!token) return NextResponse.json({ error: 'GitHub token is required' }, { status: 400 });

  try {
    const result = await mergePR(prUrl, token, mergeMethod || 'merge');
    return NextResponse.json({ sha: result.sha, merged: result.merged, message: result.message || 'Pull request merged' });
  } catch (err) {
    const { status, msg } = githubErrorResponse(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
