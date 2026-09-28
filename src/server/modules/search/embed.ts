import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { embedMany, type EmbeddingModel } from "ai";

export const EMBEDDING_DIMS = 1536;
/** Roughly 400-token windows so a chunk stays a citable snippet; overlap keeps context across cuts. */
const CHUNK_CHARS = 1_600;
const CHUNK_OVERLAP = 200;

type EmbeddingProvider = "gemini" | "openai";

/**
 * Which embedding provider to use. `AI_EMBEDDING_PROVIDER` forces one; otherwise a Gemini key
 * wins over OpenAI, and neither key means no semantic search (the caller falls back to literal
 * matching). Both providers are asked for 1536 dims - Gemini truncates its native 3072 via
 * `outputDimensionality` (MRL), which the index's normalisation step already handles.
 */
function embeddingProvider(): EmbeddingProvider | null {
  const explicit = process.env.AI_EMBEDDING_PROVIDER;
  if (explicit === "gemini" || explicit === "openai") return explicit;
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

const DEFAULT_MODELS: Record<EmbeddingProvider, string> = {
  gemini: "gemini-embedding-001",
  openai: "text-embedding-3-small",
};

const modelIdFor = (provider: EmbeddingProvider) => process.env.AI_EMBEDDING_MODEL || DEFAULT_MODELS[provider];

/**
 * "provider:model" identity of the configured embedder (e.g. "gemini:gemini-embedding-001"),
 * stored on each chunk so a model switch marks every existing vector stale. Null when no
 * provider is configured.
 */
export function embeddingModelId(): string | null {
  const provider = embeddingProvider();
  return provider ? `${provider}:${modelIdFor(provider)}` : null;
}

/** The configured embedding model, or null so search degrades to literal matching. */
export function getEmbeddingModel(): EmbeddingModel | null {
  const provider = embeddingProvider();
  if (provider === "gemini") {
    return createGoogleGenerativeAI({ apiKey: geminiKey()! }).textEmbeddingModel(modelIdFor(provider) as never);
  }
  if (provider === "openai") {
    return createOpenAI({ apiKey: process.env.OPENAI_API_KEY! }).textEmbeddingModel(modelIdFor(provider) as never);
  }
  return null;
}

/** Overlapping windows that prefer a newline boundary; deterministic for tests. */
export function chunkText(text: string, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf("\n", end);
      if (boundary > start + size / 2) end = boundary;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/**
 * Embeddings for a batch of texts, or null when no provider is configured or the call fails.
 * `task` maps to Gemini's retrieval task type (documents vs queries rank differently);
 * other providers ignore it.
 */
export async function embedTexts(
  values: string[],
  task?: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<number[][] | null> {
  const model = getEmbeddingModel();
  if (!model || !values.length) return null;
  try {
    const { embeddings } = await embedMany({
      model,
      values,
      providerOptions:
        embeddingProvider() === "gemini"
          ? { google: { outputDimensionality: EMBEDDING_DIMS, ...(task ? { taskType: task } : {}) } }
          : undefined,
    });
    return embeddings;
  } catch (e) {
    console.error("[search] embedding failed", e);
    return null;
  }
}
