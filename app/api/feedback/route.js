import { NextResponse } from 'next/server';
import { recordFeedback } from '../../../lib/services/feedback.js';

export const runtime = 'nodejs';

/**
 * POST /api/feedback
 * Body: { prUrl, issue, category, severity, vote }
 * vote is "up" or "down". Recent "down" votes get folded into future
 * opencode review prompts as "don't flag things like this" context.
 */
export async function POST(req) {
  const { prUrl, issue, category, severity, vote } = await req.json();

  if (!issue) return NextResponse.json({ error: 'issue is required' }, { status: 400 });
  if (vote !== 'up' && vote !== 'down') return NextResponse.json({ error: 'vote must be "up" or "down"' }, { status: 400 });

  recordFeedback({ prUrl, issue, category, severity, vote });
  return NextResponse.json({ ok: true });
}
