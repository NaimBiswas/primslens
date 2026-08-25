import { NextResponse } from 'next/server';
import { registerInstallation, removeInstallation } from '../../../../lib/services/automation.js';

export const runtime = 'nodejs';

/**
 * POST /api/automation/register
 * Body: { githubToken, label? }
 * Connects a GitHub account for automation — stores the token and a
 * freshly generated webhook secret (encrypted at rest), and returns a
 * unique installation id this token/repo's own webhook URL is built from.
 * Anyone can call this with their own token; there's no shared
 * server-wide credential, so this is what makes automation usable by
 * someone other than whoever deployed the app.
 */
export async function POST(req) {
  const { githubToken, label } = await req.json();
  if (!githubToken || !githubToken.trim()) {
    return NextResponse.json({ error: 'githubToken is required' }, { status: 400 });
  }

  try {
    const { id, webhookSecret } = await registerInstallation({ githubToken: githubToken.trim(), label });
    return NextResponse.json({ installationId: id, webhookSecret });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/automation/register
 * Body: { installationId }
 * Disconnects an account — deletes its stored token/secret and activity
 * history. Knowing the installation id is treated as proof of ownership
 * (the same id the webhook URL itself is built from, kept client-side),
 * matching how the id is used everywhere else in this feature.
 */
export async function DELETE(req) {
  const { installationId } = await req.json();
  if (!installationId) return NextResponse.json({ error: 'installationId is required' }, { status: 400 });

  try {
    await removeInstallation(installationId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
