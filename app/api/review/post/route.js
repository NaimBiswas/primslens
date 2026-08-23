import { NextResponse } from 'next/server';
import { postPRReview } from '../../../../lib/services/github.js';
import { githubErrorResponse } from '../../../../lib/api-error.js';

export const runtime = 'nodejs';

/**
 * POST /api/review/post
 * Body: { prUrl, token, review, event? }
 * Posts review as a GitHub PR review comment. Default event: COMMENT
 */
export async function POST(req) {
  const { prUrl, token, review, event } = await req.json();

  if (!prUrl) return NextResponse.json({ error: 'prUrl is required' }, { status: 400 });
  if (!token) return NextResponse.json({ error: 'GitHub token is required' }, { status: 400 });
  if (!review) return NextResponse.json({ error: 'review data is required' }, { status: 400 });

  try {
    const result = await postPRReview(prUrl, token, review, event);
    return NextResponse.json({ id: result.id, html_url: result.html_url, message: 'Review posted successfully' });
  } catch (err) {
    const { status, msg } = githubErrorResponse(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
