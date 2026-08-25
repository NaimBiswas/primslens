import { NextResponse } from 'next/server';
import { getInstallationStatus } from '../../../../lib/services/automation.js';

export const runtime = 'nodejs';

/**
 * GET /api/automation/status?installationId=...
 * Status + recent-activity snapshot for one connected GitHub account.
 * Unlike the old server-wide version, the webhook secret returned here is
 * safe to show in any environment — it's a per-installation secret only
 * its owner (whoever holds this installationId) can ask for, not a single
 * value shared by every user of the app.
 */
export async function GET(req) {
  const installationId = req.nextUrl.searchParams.get('installationId');
  if (!installationId) return NextResponse.json({ error: 'installationId is required' }, { status: 400 });

  let status;
  try {
    status = await getInstallationStatus(installationId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 501 });
  }
  if (!status) return NextResponse.json({ error: 'Unknown automation installation' }, { status: 404 });

  const webhookUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}/api/webhooks/github/${installationId}`;
  return NextResponse.json({ ...status, webhookUrl });
}
