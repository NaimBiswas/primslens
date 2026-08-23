import { NextResponse } from 'next/server';
import { listProviders, setProviderApiKey, removeProviderCredential } from '../../../lib/services/providers.js';
import { getSelectedModel, setSelectedModel } from '../../../lib/services/model-config.js';

export const runtime = 'nodejs';

/**
 * GET /api/providers
 * Every provider opencode/models.dev knows about (~190), with which ones
 * already have a credential configured. Slim — no per-model detail.
 */
export async function GET() {
  const providers = await listProviders();
  return NextResponse.json({ providers });
}

/**
 * POST /api/providers
 * Body: { providerId, apiKey }
 * Saves an API key for a provider to opencode's own credential store
 * (~/.local/share/opencode/auth.json) — the same file `opencode providers
 * login` writes to. Never echoed back.
 */
export async function POST(req) {
  const { providerId, apiKey } = await req.json();
  if (!providerId) return NextResponse.json({ error: 'providerId is required' }, { status: 400 });
  if (!apiKey || !apiKey.trim()) return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });

  try {
    await setProviderApiKey(providerId, apiKey.trim());
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  return NextResponse.json({ configured: true });
}

/**
 * DELETE /api/providers
 * Body: { providerId }
 * Removes a provider's credential.
 */
export async function DELETE(req) {
  const { providerId } = await req.json();
  if (!providerId) return NextResponse.json({ error: 'providerId is required' }, { status: 400 });

  removeProviderCredential(providerId);

  // The selected model would otherwise silently start failing every run.
  const selected = getSelectedModel();
  if (selected && selected.startsWith(`${providerId}/`)) setSelectedModel(null);

  return NextResponse.json({ configured: false });
}
