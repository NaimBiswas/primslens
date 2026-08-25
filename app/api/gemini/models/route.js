import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * POST /api/gemini/models
 * Body: { apiKey }
 * Validates a user-supplied Gemini API key by asking Gemini itself which
 * models it exposes, rather than hardcoding a model list here that would
 * drift as Google ships/retires models (as gemini-2.0-flash already has).
 */
export async function POST(req) {
  const { apiKey } = await req.json();
  if (!apiKey || !apiKey.trim()) return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });

  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ error: data.error?.message || `Gemini API responded ${res.status}` }, { status: res.status });
  }

  const models = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({
      id: m.name.replace(/^models\//, ''),
      name: m.displayName || m.name,
      description: m.description || null,
      inputTokenLimit: m.inputTokenLimit ?? null,
      outputTokenLimit: m.outputTokenLimit ?? null,
    }));

  return NextResponse.json({ models });
}
