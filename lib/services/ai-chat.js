import { getProvider } from './ai-providers.js';
import { fetchFileContent, commitFile } from './github.js';

const MAX_TOOL_ROUNDS = 6;
const MAX_FILE_CHARS = 20000;
const CHAT_TIMEOUT_MS = 1200000;

// The two actions the chat agent used to run itself via opencode's bash
// tool (curl against the GitHub Contents API) — now real server-side calls
// the model invokes as tools, so a provider without shell access (i.e. all
// of them, once we stopped shelling out to opencode) can still preview and
// commit fixes.
const TOOL_SCHEMAS = [
  {
    name: 'read_file',
    description: "Fetch a file's current content from the PR's head branch.",
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Repo-relative file path, e.g. lib/services/github.js' } },
      required: ['path'],
    },
  },
  {
    name: 'commit_file',
    description: "Commit new content for a file to the PR's head branch. Only call this after the user has explicitly confirmed a previously shown preview — never in the same turn a fix is first proposed.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo-relative file path' },
        content: { type: 'string', description: 'The complete new file content, not a diff' },
        message: { type: 'string', description: 'Commit message' },
      },
      required: ['path', 'content', 'message'],
    },
  },
];

export const SYSTEM_PROMPT = `You are the PrismLens Chat Agent — the interactive assistant inside the PrismLens code review web app. You help developers understand and act on automated PR review results.

You have two tools:
- read_file({ path }): fetches a file's current content from the PR's branch.
- commit_file({ path, content, message }): commits new content for a file to the PR's branch.

## How to respond
- Be concise. Use markdown formatting.
- If the user asks a question about the review, answer using the review data given to you.
- If the user wants to **fix** an issue, this is always a two-step conversation. Never call read_file and commit_file in the same turn the user first asks for a fix.
  1. **Preview turn** (first ask, e.g. "fix the == in util.js"): call read_file, compute the fix yourself (in your own reasoning, not via a tool), and reply with a unified-diff-style preview (- old line / + new line) of exactly what would change. Ask the user to confirm (e.g. "Reply \`commit\` to push this change"). Do not call commit_file yet.
  2. **Commit turn** (only after the user explicitly confirms, e.g. "commit", "yes", "push it", "confirm"): call read_file again to get fresh content (it may have changed since the preview), recompute the same fix, then call commit_file. Report the commit URL from the tool's result in your reply.
  - If the user's message doesn't clearly confirm a specific pending preview, treat it as a new preview request rather than committing.
  - If the user says "commit all" or "fix all", still show the full preview of every proposed change first and wait for one confirmation before calling commit_file for any of them.

## Automated fix patterns
Apply these when the user asks:
1. **require() → import**: \`const X = require('y')\` → \`import X from 'y'\`
2. **== → ===**: replace loose equality with strict equality (don't touch existing \`===\`).
3. **console.log guard**: wrap console.log/dir/table/warn/error in \`if (process.env.DEBUG) { ... }\`.
4. **Chained property access** without optional chaining: add \`?.\` for deep paths.

## Documentation generation
When the user asks you to **document**, **add docstrings/comments to**, or **explain** a specific file or function, treat it as the same two-step preview → confirm → commit flow as a fix — never write directly. Document only what the user pointed at. Never invent behavior — describe what the code actually does, using real parameter names and the real return value.

## Unfixable items
For TODOs, magic numbers, deep nesting, etc., suggest manual changes instead — don't try to "fix" these automatically.

## No-op responses
If the user just says hello, greets, or asks a general question (not about the review), respond naturally with a brief greeting and offer to help with the review.`;

async function executeToolCall(name, args, { prUrl, token }) {
  try {
    if (name === 'read_file') {
      const { content, sha } = await fetchFileContent(prUrl, token, args.path);
      const truncated = content.length > MAX_FILE_CHARS;
      return { content: content.slice(0, MAX_FILE_CHARS), truncated, sha };
    }
    if (name === 'commit_file') {
      const result = await commitFile(prUrl, token, args.path, args.content, args.message);
      return { url: result.commit?.html_url || result.content?.html_url || null };
    }
    return { error: `Unknown tool: ${name}` };
  } catch (err) {
    return { error: err.response?.data?.message || err.message };
  }
}

async function runOpenAICompatibleChat(provider, apiKey, model, systemPrompt, history, message, execTool) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ];
  const tools = TOOL_SCHEMAS.map((t) => ({ type: 'function', function: t }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools, temperature: 0 }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `${provider.name} API responded ${res.status}`);

    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error(`No response from ${provider.name}`);
    messages.push(msg);
    if (!msg.tool_calls?.length) return msg.content || '';

    for (const call of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* malformed args — pass through empty */ }
      const result = await execTool(call.function.name, args);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return 'Reached the tool-call limit without a final answer — try rephrasing or breaking the request into smaller steps.';
}

async function runAnthropicChat(apiKey, model, systemPrompt, history, message, execTool) {
  const messages = [...history.map((h) => ({ role: h.role, content: h.content })), { role: 'user', content: message }];
  const tools = TOOL_SCHEMAS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 4096, system: systemPrompt, messages, tools, temperature: 0 }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `Anthropic API responded ${res.status}`);

    const blocks = data.content || [];
    const toolUses = blocks.filter((b) => b.type === 'tool_use');
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (!toolUses.length) return text;

    messages.push({ role: 'assistant', content: blocks });
    const toolResults = [];
    for (const use of toolUses) {
      const result = await execTool(use.name, use.input || {});
      toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'user', content: toolResults });
  }
  return 'Reached the tool-call limit without a final answer — try rephrasing or breaking the request into smaller steps.';
}

async function runGeminiChat(apiKey, model, systemPrompt, history, message, execTool) {
  const contents = [
    ...history.map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] })),
    { role: 'user', parts: [{ text: message }] },
  ];
  const tools = [{ functionDeclarations: TOOL_SCHEMAS }];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        tools,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `Gemini API responded ${res.status}`);

    const parts = data.candidates?.[0]?.content?.parts || [];
    const functionCalls = parts.filter((p) => p.functionCall);
    const text = parts.filter((p) => p.text).map((p) => p.text).join('\n');
    if (!functionCalls.length) return text;

    contents.push({ role: 'model', parts });
    const responseParts = [];
    for (const p of functionCalls) {
      const result = await execTool(p.functionCall.name, p.functionCall.args || {});
      responseParts.push({ functionResponse: { name: p.functionCall.name, response: result } });
    }
    contents.push({ role: 'user', parts: responseParts });
  }
  return 'Reached the tool-call limit without a final answer — try rephrasing or breaking the request into smaller steps.';
}

/**
 * Runs one chat turn against a provider, letting the model call `read_file`/
 * `commit_file` (executed here, against the real GitHub API) as many rounds
 * as it needs before producing a final text reply. `history` is the prior
 * turns as `{role: 'user'|'assistant', content}` — the same shape regardless
 * of provider; each branch below adapts it to that provider's own format.
 */
export async function runProviderChat({ providerId, apiKey, model, systemPrompt, message, history, prUrl, token }) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error('Unknown AI provider');
  const execTool = (name, args) => executeToolCall(name, args, { prUrl, token });

  if (provider.kind === 'anthropic') return runAnthropicChat(apiKey, model, systemPrompt, history, message, execTool);
  if (provider.kind === 'gemini') return runGeminiChat(apiKey, model, systemPrompt, history, message, execTool);
  return runOpenAICompatibleChat(provider, apiKey, model, systemPrompt, history, message, execTool);
}
