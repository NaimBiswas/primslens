import { getProvider, resolveEnvBackend } from './ai-providers.js';
import { runProviderChat, SYSTEM_PROMPT } from './ai-chat.js';

// Trimmed to what the chat agent actually needs to answer questions about
// the review — `files` carries full patches per file, which would bloat
// every chat turn's prompt for little benefit; the agent has `read_file`
// for any file content it genuinely needs.
function buildSystemPrompt(review) {
  const trimmed = { meta: review?.meta, reviews: review?.reviews, recommendation: review?.recommendation };
  return `${SYSTEM_PROMPT}\n\n## Review data\n${JSON.stringify(trimmed)}`;
}

/**
 * `aiOverride`, when passed, is the user's own provider/key/model choice
 * from the Model page's unified picker (same shape analyzer.js's analyzePR
 * takes) — takes priority over the server's own env-configured provider.
 */
export async function processChatMessage({ message, prUrl, token, review, history, aiOverride }) {
  const backend = aiOverride?.providerId && aiOverride?.apiKey ? aiOverride : resolveEnvBackend();
  if (!backend) {
    return { role: 'assistant', content: 'No AI backend configured. Connect a provider key in the Model page to use chat.' };
  }

  const provider = getProvider(backend.providerId);
  try {
    const { content, committed } = await runProviderChat({
      providerId: backend.providerId,
      apiKey: backend.apiKey,
      model: backend.model || provider.defaultModel,
      systemPrompt: buildSystemPrompt(review),
      message,
      history: history || [],
      prUrl,
      token,
    });
    // `committed` is only meaningful to automation.js (interactive chat has
    // no pending-approval tracking to update) — harmless extra field here.
    return { role: 'assistant', content: content || 'No response.', committed };
  } catch (err) {
    return { role: 'assistant', content: `Error: ${err.message}` };
  }
}
