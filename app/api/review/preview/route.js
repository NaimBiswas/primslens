import { NextResponse } from 'next/server';
import { fetchPR } from '../../../../lib/services/github.js';
import { githubErrorResponse } from '../../../../lib/api-error.js';

export const runtime = 'nodejs';

/**
 * POST /api/review/preview
 * Body: { prUrl, token }
 * Returns: { prData } — raw PR metadata (lightweight preview)
 */
export async function POST(req) {
  const { prUrl, token } = await req.json();

  if (!prUrl) return NextResponse.json({ error: 'prUrl is required' }, { status: 400 });
  if (!token) return NextResponse.json({ error: 'GitHub token is required' }, { status: 400 });

  try {
    const prData = await fetchPR(prUrl, token);
    return NextResponse.json({
      title: prData.title,
      author: prData.user?.login,
      number: prData.number,
      state: prData.state,
      html_url: prData.html_url,
      created_at: prData.created_at,
      head: { ref: prData.head?.ref, sha: prData.head?.sha },
      base: { ref: prData.base?.ref, sha: prData.base?.sha },
    });
  } catch (err) {
    const { status, msg } = githubErrorResponse(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
