import { NextResponse } from 'next/server';
import { fetchPR, fetchPRFiles } from '../../../lib/services/github.js';
import { analyzePR } from '../../../lib/services/analyzer.js';
import { loadReviewConfig } from '../../../lib/services/review-config.js';
import { githubErrorResponse } from '../../../lib/api-error.js';

export const runtime = 'nodejs';
// AI review can take several minutes on a large PR; this only matters on
// platforms that enforce a function timeout (e.g. Vercel).
export const maxDuration = 300;

/**
 * POST /api/review
 * Body: { prUrl: string, token: string, aiProviderId?: string, aiApiKey?: string, aiModel?: string, aiDisabled?: boolean }
 * `aiProviderId`/`aiApiKey`/`aiModel` come from a user's own key entered in
 * the Model page's unified model picker — when present they're used instead
 * of whatever provider the server has configured via env vars. `aiDisabled`
 * is set when the user explicitly picked "no AI backend" (regex fallback
 * only), so a server-configured provider must be skipped too.
 *
 * Streams newline-delimited JSON so the client can show real pipeline state
 * (fetching PR, pulling codebase tree, running AI review, ...) instead of a
 * single opaque "analyzing" spinner. Each line is one of:
 *   {"type":"progress","stage":"...","label":"...","data"?: ...}
 *   {"type":"result","data": <review>}
 *   {"type":"error","error":"..."}
 * `data` on a progress line is set for the "ai-finding" stage — the finding
 * object itself, streamed the moment the AI produces it, before the review
 * as a whole is done. The stream always ends with exactly one "result" or
 * "error" line.
 */
export async function POST(req) {
  const { prUrl, token, aiProviderId, aiApiKey, aiModel, aiDisabled } = await req.json();

  if (!prUrl) return NextResponse.json({ error: 'prUrl is required' }, { status: 400 });
  if (!token) return NextResponse.json({ error: 'GitHub token is required' }, { status: 400 });

  const aiOverride = aiProviderId && aiApiKey
    ? { providerId: aiProviderId, apiKey: aiApiKey, model: aiModel || undefined }
    : aiDisabled ? { disabled: true } : null;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      const onProgress = (stage, label, data) => send({ type: 'progress', stage, label, data });

      try {
        onProgress('fetch-pr', 'Fetching PR metadata & changed files…');
        const [prData, files, config] = await Promise.all([
          fetchPR(prUrl, token),
          fetchPRFiles(prUrl, token),
          loadReviewConfig(prUrl, token),
        ]);
        onProgress('files-ready', `${files.length} file(s) changed — starting analysis…`);

        const review = await analyzePR(prData, files, config, token, onProgress, aiOverride);
        send({ type: 'result', data: review });
      } catch (err) {
        const { msg } = githubErrorResponse(err);
        send({ type: 'error', error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
