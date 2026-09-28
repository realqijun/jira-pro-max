import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type { UploadedFile } from "./service";

const PROMPT =
  "Transcribe every piece of text in this document verbatim, preserving reading order. Output only the transcription - no commentary, no markdown fences.";

/**
 * A file markitdown cannot read is offered to the model as-is: PDFs go as file input, images
 * as image input, anything else as file input for the API to accept or reject. Covers scanned
 * and image-only PDFs, which carry no text layer for markitdown to find. Never throws -
 * a missing key, unsupported format or failed call returns null and the caller keeps whatever
 * extraction produced, like every other enrichment here.
 */
export async function fileToTextViaModel(file: UploadedFile): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const model = createOpenAI({ apiKey })(process.env.AI_MODEL || "gpt-4o-mini");
    const res = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            file.type.startsWith("image/")
              ? { type: "image", image: file.bytes }
              : { type: "file", data: file.bytes, mediaType: file.type },
          ],
        },
      ],
    });
    return res.text.trim() || null;
  } catch (e) {
    console.error(`[evidence] model transcription failed for ${file.name} (${file.type})`, e);
    return null;
  }
}
