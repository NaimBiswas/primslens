import { NextResponse } from 'next/server';
import { getAutomationStatus } from '../../../../lib/services/automation.js';

export const runtime = 'nodejs';

/**
 * GET /api/automation/status
 * Configuration + recent-activity snapshot for the Automation dashboard.
 * Never exposes the token or webhook secret values.
 */
export async function GET(req) {
  const status = await getAutomationStatus();
  const webhookUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}/api/webhooks/github`;
  return NextResponse.json({ ...status, webhookUrl });
}
