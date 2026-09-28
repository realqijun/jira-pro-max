/**
 * LitePruner client (https://litepruner.ai/docs): compresses an Evidence item's text once at
 * ingest so chunking and embedding spend fewer tokens. Never throws - a missing key, short
 * text or a failed request returns null and the caller indexes the full text instead.
 */
export interface PruneResult {
  text: string;
  originalTokens: number;
  prunedTokens: number;
}

/** Below this the compression can't save enough to be worth a paid call. */
const MIN_CHARS = 2_000;
const TIMEOUT_MS = 15_000;

export async function pruneText(text: string): Promise<PruneResult | null> {
  const apiKey = process.env.LITEPRUNER_API_KEY;
  if (!apiKey || text.trim().length < MIN_CHARS) return null;
  try {
    const res = await fetch(process.env.LITEPRUNER_API_URL || "https://litepruner.ai/compress-text", {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text, compression_ratio: Number(process.env.LITEPRUNER_RATIO) || 0.7 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[search] LitePruner responded ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      pruned_text?: string;
      original_tokens?: number;
      pruned_tokens?: number;
    };
    const pruned = data.pruned_text?.trim();
    if (!pruned) return null;
    return { text: pruned, originalTokens: data.original_tokens ?? 0, prunedTokens: data.pruned_tokens ?? 0 };
  } catch (e) {
    console.error("[search] LitePruner request failed", e);
    return null;
  }
}
