/**
 * Tiny multi-provider LLM client.
 *
 * We deliberately use the native `fetch` available in Node 20 instead of pulling
 * in three vendor SDKs — keeps the bundled action well under 1 MB and lets users
 * pick whichever provider has API credit available.
 */

export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'github-models';

export interface CompletionRequest {
  system: string;
  user: string;
  model: string;
  /** Soft cap on output tokens. */
  maxTokens?: number;
}

export interface CompletionResponse {
  text: string;
  /** Best-effort usage info; not all providers return all fields. */
  usage?: {inputTokens?: number; outputTokens?: number};
}

const DEFAULT_MODELS: Record<ProviderId, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-latest',
  gemini: 'gemini-1.5-pro',
  // GitHub Models uses `<publisher>/<model>` IDs.
  'github-models': 'openai/gpt-4o-mini',
};

export function resolveModel(provider: ProviderId, override: string): string {
  return override.trim() || DEFAULT_MODELS[provider];
}

export function isProvider(s: string): s is ProviderId {
  return (
    s === 'openai' ||
    s === 'anthropic' ||
    s === 'gemini' ||
    s === 'github-models'
  );
}

export async function complete(
  provider: ProviderId,
  apiKey: string,
  req: CompletionRequest,
): Promise<CompletionResponse> {
  switch (provider) {
    case 'openai':
      return openai(apiKey, req);
    case 'anthropic':
      return anthropic(apiKey, req);
    case 'gemini':
      return gemini(apiKey, req);
    case 'github-models':
      return githubModels(apiKey, req);
  }
}

async function openai(apiKey: string, req: CompletionRequest): Promise<CompletionResponse> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens ?? 2048,
      temperature: 0.2,
      messages: [
        {role: 'system', content: req.system},
        {role: 'user', content: req.user},
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    choices: {message: {content: string}}[];
    usage?: {prompt_tokens?: number; completion_tokens?: number};
  };
  return {
    text: json.choices[0]?.message.content ?? '',
    usage: {
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
    },
  };
}

async function anthropic(apiKey: string, req: CompletionRequest): Promise<CompletionResponse> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens ?? 2048,
      system: req.system,
      messages: [{role: 'user', content: req.user}],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    content: {type: string; text?: string}[];
    usage?: {input_tokens?: number; output_tokens?: number};
  };
  const text = json.content
    .filter(c => c.type === 'text')
    .map(c => c.text ?? '')
    .join('');
  return {
    text,
    usage: {
      inputTokens: json.usage?.input_tokens,
      outputTokens: json.usage?.output_tokens,
    },
  };
}

async function gemini(apiKey: string, req: CompletionRequest): Promise<CompletionResponse> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      systemInstruction: {parts: [{text: req.system}]},
      contents: [{role: 'user', parts: [{text: req.user}]}],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: req.maxTokens ?? 2048,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    candidates?: {content?: {parts?: {text?: string}[]}}[];
    usageMetadata?: {promptTokenCount?: number; candidatesTokenCount?: number};
  };
  const text =
    json.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
  return {
    text,
    usage: {
      inputTokens: json.usageMetadata?.promptTokenCount,
      outputTokens: json.usageMetadata?.candidatesTokenCount,
    },
  };
}

/**
 * GitHub Models inference — OpenAI-compatible endpoint hosted by GitHub.
 *
 * Auth: pass the workflow's built-in GITHUB_TOKEN (with `models: read`
 * permission) or a fine-grained PAT with the `models` scope. Available to
 * GitHub Free tier and included in GitHub Enterprise / Copilot subscriptions.
 *
 * Docs: https://docs.github.com/en/github-models
 */
async function githubModels(
  apiKey: string,
  req: CompletionRequest,
): Promise<CompletionResponse> {
  const res = await fetch('https://models.github.ai/inference/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens ?? 2048,
      temperature: 0.2,
      messages: [
        {role: 'system', content: req.system},
        {role: 'user', content: req.user},
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub Models ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    choices: {message: {content: string}}[];
    usage?: {prompt_tokens?: number; completion_tokens?: number};
  };
  return {
    text: json.choices[0]?.message.content ?? '',
    usage: {
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
    },
  };
}
