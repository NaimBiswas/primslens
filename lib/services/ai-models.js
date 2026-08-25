import { getProvider } from './ai-providers.js';

function formatContext(n) {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M context`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K context`;
  return `${n} context`;
}

async function listGeminiModels(apiKey) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Gemini responded ${res.status}`);
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({
      id: m.name.replace(/^models\//, ''),
      name: m.displayName || m.name,
      meta: [formatContext(m.inputTokenLimit), m.description].filter(Boolean).join(' · '),
      free: false,
    }));
}

async function listAnthropicModels(provider, apiKey) {
  const res = await fetch(`${provider.baseUrl}/models`, {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Anthropic responded ${res.status}`);
  return (data.data || []).map((m) => ({
    id: m.id,
    name: m.display_name || m.id,
    meta: '',
    free: false,
  }));
}

// Covers every OpenAI-compatible provider (OpenAI, Groq, Mistral, DeepSeek).
// Their /models response only carries id/owner, no pricing or context.
function describeGenericOpenAIModel(m) {
  const parts = [];
  if (m.context_window) parts.push(formatContext(m.context_window));
  if (m.owned_by) parts.push(m.owned_by);
  return parts.join(' · ');
}

// OpenRouter's /models response additionally carries pricing (string $/token)
// and context_length, so its models get real cost/context/free labels.
function describeOpenRouterModel(m) {
  const parts = [formatContext(m.context_length)].filter(Boolean);
  const promptCost = Number(m.pricing?.prompt);
  const completionCost = Number(m.pricing?.completion);
  const free = m.pricing && promptCost === 0 && completionCost === 0;
  if (free) {
    parts.push('free');
  } else if (m.pricing && (promptCost > 0 || completionCost > 0)) {
    const fmt = (n) => {
      const per1M = n * 1_000_000;
      return per1M >= 1 ? per1M.toFixed(2).replace(/\.?0+$/, '') : per1M.toPrecision(2);
    };
    parts.push(`$${fmt(promptCost)}/$${fmt(completionCost)} per 1M tokens`);
  }
  return { meta: parts.join(' · '), free: !!free };
}

async function listOpenAICompatibleModels(provider, apiKey) {
  const res = await fetch(`${provider.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `${provider.name} responded ${res.status}`);

  return (data.data || []).map((m) => {
    if (provider.id === 'openrouter') {
      const { meta, free } = describeOpenRouterModel(m);
      return { id: m.id, name: m.name || m.id, meta, free };
    }
    return { id: m.id, name: m.id, meta: describeGenericOpenAIModel(m), free: false };
  });
}

export async function listModelsForProvider(providerId, apiKey) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error('Unknown provider');
  if (!apiKey || !apiKey.trim()) throw new Error('apiKey is required');
  const key = apiKey.trim();

  if (provider.kind === 'gemini') return listGeminiModels(key);
  if (provider.kind === 'anthropic') return listAnthropicModels(provider, key);
  return listOpenAICompatibleModels(provider, key);
}
