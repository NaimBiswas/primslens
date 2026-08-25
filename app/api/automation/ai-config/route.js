import { NextResponse } from 'next/server';
import { setAutomationAIConfig } from '../../../../lib/services/automation.js';

export const runtime = 'nodejs';

/**
 * POST /api/automation/ai-config
 * Body: { installationId, providerId, apiKey, model }
 * Points this installation's automated reviews/replies at a specific
 * provider/key — typically whatever the account already has active on the
 * Model page — instead of the server's env-configured default. Omitting
 * providerId/apiKey (or sending them empty) clears the override.
 */
export async function POST(req) {
  const { installationId, providerId, apiKey, model } = await req.json();
  if (!installationId) return NextResponse.json({ error: 'installationId is required' }, { status: 400 });

  try {
    const config = providerId && apiKey ? { providerId, apiKey, model } : null;
    await setAutomationAIConfig(installationId, config);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
