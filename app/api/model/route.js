import { NextResponse } from 'next/server';
import { listFreeModels } from '../../../lib/services/models.js';
import { getSelectedModel, setSelectedModel } from '../../../lib/services/model-config.js';

export const runtime = 'nodejs';

/**
 * GET /api/model
 * Lists opencode's free models and the current selection (null = opencode's
 * own default, whatever that resolves to).
 */
export async function GET() {
  const models = await listFreeModels();
  return NextResponse.json({ models, selected: getSelectedModel(), opencodeAvailable: models.length > 0 });
}

/**
 * POST /api/model
 * Body: { model: string | null }
 * Sets the model used for future review/chat runs. Rejects anything not in
 * the current free-model list, except null (reset to opencode's default).
 */
export async function POST(req) {
  const { model } = await req.json();

  if (model !== null && model !== undefined) {
    const models = await listFreeModels();
    if (!models.some((m) => m.id === model)) {
      return NextResponse.json({ error: 'Unknown model' }, { status: 400 });
    }
  }

  setSelectedModel(model || null);
  return NextResponse.json({ selected: getSelectedModel() });
}
