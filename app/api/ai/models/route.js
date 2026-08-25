import { NextResponse } from 'next/server';
import { listModelsForProvider } from '../../../../lib/services/ai-models.js';
import { listProviderDefs } from '../../../../lib/services/ai-providers.js';

export const runtime = 'nodejs';

/**
 * GET /api/ai/models
 * The static registry of supported providers (id, name, key placeholder,
 * docs link) — no credentials, just enough for the Model page to render a
 * key-input row per provider.
 */
export async function GET() {
  return NextResponse.json({ providers: listProviderDefs() });
}

/**
 * POST /api/ai/models
 * Body: { providerId, apiKey }
 * Validates a user-supplied key by asking that provider itself which
 * models it exposes, rather than hardcoding a model list here that would
 * drift as providers ship/retire models.
 */
export async function POST(req) {
  const { providerId, apiKey } = await req.json();
  if (!providerId) return NextResponse.json({ error: 'providerId is required' }, { status: 400 });
  if (!apiKey || !apiKey.trim()) return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });

  try {
    const models = await listModelsForProvider(providerId, apiKey);
    return NextResponse.json({ models });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
