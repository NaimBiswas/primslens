import { NextResponse } from 'next/server';
import { fetchPR, fetchPRFiles } from '../../../lib/services/github.js';
import { analyzePR } from '../../../lib/services/analyzer.js';
import { loadReviewConfig } from '../../../lib/services/review-config.js';
import { githubErrorResponse } from '../../../lib/api-error.js';

export const runtime = 'nodejs';

/**
 * POST /api/review
 * Body: { prUrl: string, token: string }
 * Returns: { meta, reviews, strengths, concerns, bugs, info, recommendation, files }
 */
export async function POST(req) {
  const { prUrl, token } = await req.json();

  if (!prUrl) return NextResponse.json({ error: 'prUrl is required' }, { status: 400 });
  if (!token) return NextResponse.json({ error: 'GitHub token is required' }, { status: 400 });

  try {
    const [prData, files, config] = await Promise.all([
      fetchPR(prUrl, token),
      fetchPRFiles(prUrl, token),
      loadReviewConfig(prUrl, token),
    ]);

    const review = await analyzePR(prData, files, config, token);
    return NextResponse.json(review);
  } catch (err) {
    const { status, msg } = githubErrorResponse(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
