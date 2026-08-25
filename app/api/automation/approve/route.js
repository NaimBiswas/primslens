import { NextResponse } from 'next/server';
import { approvePendingApproval } from '../../../../lib/services/automation.js';

export const runtime = 'nodejs';

/**
 * POST /api/automation/approve
 * Body: { installationId, prUrl }
 * Approves a pending fix preview shown in the dashboard by posting a
 * "commit" comment on the PR using the account's own token — the same
 * trigger a human typing "commit" on GitHub would produce, so it flows
 * through the normal webhook pipeline (with the earlier preview's
 * conversation history intact) rather than a separate commit code path.
 */
export async function POST(req) {
  const { installationId, prUrl } = await req.json();
  if (!installationId) return NextResponse.json({ error: 'installationId is required' }, { status: 400 });
  if (!prUrl) return NextResponse.json({ error: 'prUrl is required' }, { status: 400 });

  try {
    await approvePendingApproval(installationId, prUrl);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
