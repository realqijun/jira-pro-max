/**
 * Image generation, isolated from the Assistant's model on purpose: the render preview is a
 * free feature of the app, so it must not spend the key the User configured for their own
 * Assistant (ADR 0007). Different key, different provider, different failure mode.
 */
const BASE_URL = "https://gen.pollinations.ai/image";

/** Supports `seed`, which is what makes a Render reproducible from its stored provenance. */
export const RENDER_MODEL = "tongyi-mai/z-image-turbo";
export const RENDER_WIDTH = 1024;
export const RENDER_HEIGHT = 768;
/** Generation usually lands inside 30s; past this the row fails rather than pending forever. */
const TIMEOUT_MS = 90_000;

/**
 * Steer the model towards a clean concept sketch and away from a photoreal image that would
 * read as a photograph of something already built.
 */
const STYLE_SUFFIX =
  "clean architectural concept sketch, line drawing with light shading, neutral background, no text, no annotations, no dimension markings";

/** The app boots without a key; the tab then says the preview is not configured. */
export function isRenderConfigured(): boolean {
  return Boolean(process.env.POLLINATIONS_API_KEY);
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
}

/** What the provider was actually asked for, stored with the row as provenance. */
export const promptSentFor = (prompt: string) => `${prompt}. ${STYLE_SUFFIX}`;

class RenderProviderError extends Error {}

function messageForStatus(status: number): string {
  if (status === 401 || status === 403) return "The image service rejected our credentials.";
  if (status === 402) return "The image service preview has run out of free credit.";
  if (status === 429) return "The image service is rate limiting us. Try again in a minute.";
  if (status === 400) return "The image service refused this description. Try rewording it.";
  return `The image service failed (HTTP ${status}).`;
}

/**
 * Generate one image. Throws `RenderProviderError` with a message meant for the PM; the
 * service stores it on the row verbatim, so it must never carry a key or a stack trace.
 *
 * `safe=privacy,secrets` asks the provider to reject prompts carrying personal data or
 * credentials. It is a backstop, not the control: the prompt is written by hand and no
 * Project data is ever put into it (see the service).
 */
export async function generateImage(prompt: string, seed: number): Promise<GeneratedImage> {
  const apiKey = process.env.POLLINATIONS_API_KEY;
  if (!apiKey) throw new RenderProviderError("Image previews are not configured.");

  const url = new URL(`${BASE_URL}/${encodeURIComponent(promptSentFor(prompt))}`);
  url.searchParams.set("model", RENDER_MODEL);
  url.searchParams.set("width", String(RENDER_WIDTH));
  url.searchParams.set("height", String(RENDER_HEIGHT));
  url.searchParams.set("seed", String(seed));
  url.searchParams.set("safe", "privacy,secrets");

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // Includes the timeout. The cause is logged for us and summarised for the PM.
    console.error("Render provider request failed", e);
    throw new RenderProviderError("The image service did not respond in time.");
  }

  if (!res.ok) throw new RenderProviderError(messageForStatus(res.status));

  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!mimeType.startsWith("image/")) throw new RenderProviderError("The image service returned something else.");

  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) throw new RenderProviderError("The image service returned an empty image.");
  return { bytes, mimeType };
}

/** A provider message is safe to show; anything else is summarised. */
export const messageForFailure = (e: unknown) =>
  e instanceof RenderProviderError ? e.message : "Generation failed unexpectedly.";
