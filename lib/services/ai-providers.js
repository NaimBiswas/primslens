/**
 * Static registry of the AI providers PrismLens can call directly over
 * HTTPS — no CLI binary, no subprocess, so nothing to install or ship on a
 * serverless host. `kind` selects which request/response shape a provider
 * speaks: 'openai' covers every OpenAI-compatible chat/completions API
 * (OpenAI itself, Groq, OpenRouter, Mistral, DeepSeek all implement it),
 * 'anthropic' and 'gemini' are their own APIs.
 */
export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    kind: 'gemini',
    envKey: 'GEMINI_API_KEY',
    envModel: 'GEMINI_MODEL',
    defaultModel: 'gemini-3.6-flash',
    keyPlaceholder: 'AIza… / Gemini API key',
    docsUrl: 'https://aistudio.google.com/apikey',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    envModel: 'OPENAI_MODEL',
    defaultModel: 'gpt-4o-mini',
    keyPlaceholder: 'sk-…',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
    envModel: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-haiku-4-5-20251001',
    keyPlaceholder: 'sk-ant-…',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    envModel: 'GROQ_MODEL',
    defaultModel: 'llama-3.3-70b-versatile',
    keyPlaceholder: 'gsk_…',
    docsUrl: 'https://console.groq.com/keys',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    envModel: 'OPENROUTER_MODEL',
    defaultModel: 'openai/gpt-4o-mini',
    keyPlaceholder: 'sk-or-v1-…',
    docsUrl: 'https://openrouter.ai/keys',
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    envKey: 'MISTRAL_API_KEY',
    envModel: 'MISTRAL_MODEL',
    defaultModel: 'mistral-small-latest',
    keyPlaceholder: 'API key…',
    docsUrl: 'https://console.mistral.ai/api-keys',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    envKey: 'DEEPSEEK_API_KEY',
    envModel: 'DEEPSEEK_MODEL',
    defaultModel: 'deepseek-chat',
    keyPlaceholder: 'sk-…',
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
};

export function getProvider(id) {
  return PROVIDERS[id] || null;
}

export function listProviderDefs() {
  return Object.values(PROVIDERS).map(({ id, name, kind, keyPlaceholder, docsUrl }) => ({ id, name, kind, keyPlaceholder, docsUrl }));
}

/**
 * Priority order for picking a server-configured (.env) backend when no
 * client override is present — first provider with a non-empty env key
 * wins. GEMENI_API_KEY is a fallback name for a typo already in some .env
 * files; GEMINI_API_KEY is the documented spelling.
 */
export function resolveEnvBackend() {
  for (const provider of Object.values(PROVIDERS)) {
    const key = process.env[provider.envKey] || (provider.id === 'gemini' ? process.env.GEMENI_API_KEY : null);
    if (key) return { providerId: provider.id, apiKey: key, model: process.env[provider.envModel] || provider.defaultModel };
  }
  return null;
}
