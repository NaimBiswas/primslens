import { NextResponse } from 'next/server';
import { listSelectableModels } from '../../../lib/services/models.js';
import { getSelectedModel, setSelectedModel } from '../../../lib/services/model-config.js';
import { findOpenCode } from '../../../lib/services/shared.js';

export const runtime = 'nodejs';

/**
 * GET /api/model
 * Lists every selectable model — opencode's free ones plus any provider
 * the user has connected credentials for — and the current selection
 * (null = opencode's own default, whatever that resolves to).
 */
export async function GET() {
  const [models, opencodePath] = await Promise.all([listSelectableModels(), findOpenCode()]);
  return NextResponse.json({ models, selected: getSelectedModel(), opencodeAvailable: !!opencodePath });
}

/**
 * POST /api/model
 * Body: { model: string | null }
 * Sets the model used for future review/chat runs. Rejects anything not in
 * the current selectable-model list, except null (reset to opencode's default).
 */
export async function POST(req) {
  const { model } = await req.json();

  if (model !== null && model !== undefined) {
    const models = await listSelectableModels();
    if (!models.some((m) => m.id === model)) {
      return NextResponse.json({ error: 'Unknown model' }, { status: 400 });
    }
  }

  setSelectedModel(model || null);
  return NextResponse.json({ selected: getSelectedModel() });
}
