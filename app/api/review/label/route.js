import { NextResponse } from 'next/server';
import { applyLabels, computeLabels } from '../../../../lib/services/github.js';
import { githubErrorResponse } from '../../../../lib/api-error.js';

export const runtime = 'nodejs';

/**
 * POST /api/review/label
 * Body: { prUrl, token, review }
 * Derives a size/* and risk/* label from the review (diff size, verdict,
 * severity of bugs found), creates them on the repo if they don't exist
 * yet, and applies them to the PR.
 */
export async function POST(req) {
  const { prUrl, token, review } = await req.json();

  if (!prUrl) return NextResponse.json({ error: 'prUrl is required' }, { status: 400 });
  if (!token) return NextResponse.json({ error: 'GitHub token is required' }, { status: 400 });
  if (!review) return NextResponse.json({ error: 'review data is required' }, { status: 400 });

  try {
    const labels = computeLabels(review);
    await applyLabels(prUrl, token, labels);
    return NextResponse.json({ labels, message: 'Labels applied' });
  } catch (err) {
    const { status, msg } = githubErrorResponse(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
