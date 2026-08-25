import { NextResponse } from 'next/server';
import { processChatMessage } from '../../../lib/services/chat.js';
import { githubErrorResponse } from '../../../lib/api-error.js';

export const runtime = 'nodejs';
// Chat can shell out to opencode for up to 1200s (20 min); this only matters
// on platforms that enforce a function timeout. Self-hosted (`next start`)
// has none, so this is documentation of intent more than an enforced limit.
export const maxDuration = 300;

/**
 * POST /api/chat
 * Body: { message, prUrl, token, review, history }
 * Interact with review findings — fix, commit, list, etc.
 */
export async function POST(req) {
  const { message, prUrl, token, review, history } = await req.json();
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 });
  if (!prUrl) return NextResponse.json({ error: 'prUrl is required' }, { status: 400 });
  if (!token) return NextResponse.json({ error: 'GitHub token is required' }, { status: 400 });
  if (!review) return NextResponse.json({ error: 'review data is required' }, { status: 400 });

  try {
    const result = await processChatMessage({ message, prUrl, token, review, history });
    return NextResponse.json(result);
  } catch (err) {
    const { status, msg } = githubErrorResponse(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
