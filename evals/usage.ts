/**
 * Token, latency and cost capture for the evaluation harness.
 *
 * The production code paths do not all return usage: `modelExtract` throws away everything except
 * the parsed object. Rather than fork those functions for the harness, this wraps `globalThis.fetch`
 * and reads the usage block out of each gateway response, which every OpenAI-compatible endpoint
 * returns. Nothing about the call itself changes, so what is measured is what production would send.
 */

export interface Call {
  endpoint: string;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  /** Prompt tokens the provider served from its own cache; a repeated system prompt is billed less. */
  cachedTokens: number;
  ms: number;
  /** Provider-reported cost in USD when the gateway returns one, else computed from pricing. */
  costUsd: number | null;
}

export interface Pricing {
  prompt: number;
  completion: number;
}

export interface UsageProbe {
  /** Calls recorded since the last `take()`. */
  take(): Call[];
  restore(): void;
}

const num = (v: unknown) => (typeof v === "number" ? v : 0);

export function installUsageProbe(pricing: Map<string, Pricing>): UsageProbe {
  const original = globalThis.fetch;
  let calls: Call[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const started = Date.now();
    const res = await original(input, init);
    const ms = Date.now() - started;
    if (!/\/(chat\/completions|embeddings|responses)(\?|$)/.test(url) || !res.ok) return res;
    const clone = res.clone();
    try {
      // Chat Completions reports `prompt_tokens`; the Responses API and the embeddings endpoint
      // report `input_tokens`. The AI SDK picks the endpoint per provider, so both are accepted.
      const body = (await clone.json()) as {
        model?: string;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          input_tokens?: number;
          output_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
          input_tokens_details?: { cached_tokens?: number };
          cache_read_input_tokens?: number;
          cost?: number;
        };
      };
      const model = body.model ?? null;
      const price = model ? pricing.get(model) : undefined;
      const promptTokens = num(body.usage?.prompt_tokens) || num(body.usage?.input_tokens);
      const completionTokens = num(body.usage?.completion_tokens) || num(body.usage?.output_tokens);
      const cachedTokens =
        num(body.usage?.prompt_tokens_details?.cached_tokens) ||
        num(body.usage?.input_tokens_details?.cached_tokens) ||
        num(body.usage?.cache_read_input_tokens);
      const computed = price ? promptTokens * price.prompt + completionTokens * price.completion : null;
      calls.push({
        endpoint: new URL(url).pathname,
        model,
        promptTokens,
        completionTokens,
        cachedTokens,
        ms,
        costUsd: typeof body.usage?.cost === "number" ? body.usage.cost : computed,
      });
      if (process.env.EVAL_DEBUG_USAGE) console.log("[usage]", url, JSON.stringify(body.usage));
    } catch {
      // A streamed or non-JSON response carries no usage block; the call is simply not measured.
    }
    return res;
  };
  return {
    take() {
      const out = calls;
      calls = [];
      return out;
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** Per-token prices from the OpenRouter model catalogue, so cost is computed rather than guessed. */
export async function loadPricing(baseUrl: string): Promise<Map<string, Pricing>> {
  const out = new Map<string, Pricing>();
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`);
    if (!res.ok) return out;
    const body = (await res.json()) as { data?: Array<{ id: string; pricing?: Record<string, string> }> };
    for (const m of body.data ?? []) {
      out.set(m.id, { prompt: Number(m.pricing?.prompt ?? 0), completion: Number(m.pricing?.completion ?? 0) });
    }
  } catch {
    // Offline or a non-OpenRouter gateway: cost stays null and latency is still reported.
  }
  return out;
}

export const totals = (calls: Call[]) => ({
  calls: calls.length,
  promptTokens: calls.reduce((a, c) => a + c.promptTokens, 0),
  completionTokens: calls.reduce((a, c) => a + c.completionTokens, 0),
  cachedTokens: calls.reduce((a, c) => a + c.cachedTokens, 0),
  costUsd: calls.reduce((a, c) => a + (c.costUsd ?? 0), 0),
});
