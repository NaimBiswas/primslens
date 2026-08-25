import { NextResponse } from 'next/server';
import { dismissPendingApproval } from '../../../../lib/services/automation.js';

export const runtime = 'nodejs';

/**
 * POST /api/automation/dismiss
 * Body: { installationId, prUrl }
 * Clears a pending fix preview from the dashboard without approving it —
 * doesn't touch the PR itself, just stops surfacing that proposal.
 */
export async function POST(req) {
  const { installationId, prUrl } = await req.json();
  if (!installationId) return NextResponse.json({ error: 'installationId is required' }, { status: 400 });
  if (!prUrl) return NextResponse.json({ error: 'prUrl is required' }, { status: 400 });

  try {
    await dismissPendingApproval(installationId, prUrl);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
