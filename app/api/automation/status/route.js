import { NextResponse } from 'next/server';
import { getAutomationStatus } from '../../../../lib/services/automation.js';

export const runtime = 'nodejs';

/**
 * GET /api/automation/status
 * Configuration + recent-activity snapshot for the Automation dashboard.
 * Never exposes the token. The webhook secret is included only outside
 * production (see getAutomationStatus in lib/services/automation.js) —
 * this route has no auth, so a deployed instance never leaks it.
 */
export async function GET(req) {
  const status = await getAutomationStatus();
  const webhookUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}/api/webhooks/github`;
  return NextResponse.json({ ...status, webhookUrl });
}
