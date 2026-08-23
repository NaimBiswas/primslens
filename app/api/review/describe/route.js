import { NextResponse } from 'next/server';
import { updatePRDescription } from '../../../../lib/services/github.js';
import { githubErrorResponse } from '../../../../lib/api-error.js';

export const runtime = 'nodejs';

/**
 * POST /api/review/describe
 * Body: { prUrl, token, review }
 * Replaces the PR's description with an auto-generated summary + file-by-file
 * walkthrough + review snapshot, built from the same review data the results
 * screen already has.
 */
export async function POST(req) {
  const { prUrl, token, review } = await req.json();

  if (!prUrl) return NextResponse.json({ error: 'prUrl is required' }, { status: 400 });
  if (!token) return NextResponse.json({ error: 'GitHub token is required' }, { status: 400 });
  if (!review) return NextResponse.json({ error: 'review data is required' }, { status: 400 });

  try {
    const result = await updatePRDescription(prUrl, token, review);
    return NextResponse.json({ html_url: result.html_url, message: 'Description updated' });
  } catch (err) {
    const { status, msg } = githubErrorResponse(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
