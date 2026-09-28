import { APICallError, RetryError, type UIMessage, type UIMessageChunk } from "ai";
import { z } from "zod";
import { TURN_ERROR, TURN_ERROR_PART, type TurnErrorData } from "@/shared/lib/assistant-errors";

const MAX_MESSAGE = 500;

/** Validates a turn-error part coming back from the client in the thread. */
export const turnErrorDataSchemas = { [TURN_ERROR]: z.object({ message: z.string().max(MAX_MESSAGE) }) };

/**
 * What the User reads when a turn fails. Never the provider's own text: it can echo request
 * details. The full error goes to the server log instead.
 */
export function turnErrorMessage(error: unknown): string {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  const status = APICallError.isInstance(cause) ? cause.statusCode : undefined;
  if (status === 401 || status === 403) return "The AI provider rejected the API key. Check it in Settings.";
  if (status === 429) return "The AI provider is rate limiting requests. Wait a moment, then try again.";
  if (status && status >= 500) return "The AI provider is unavailable right now. Try again shortly.";
  return "The Assistant could not finish this reply. Try again.";
}

// Clamped to what the schema accepts: a saved part that fails validation would reject every later turn.
export const turnErrorPart = (message: string) => ({
  type: TURN_ERROR_PART,
  data: { message: message.slice(0, MAX_MESSAGE) } satisfies TurnErrorData,
});

/** An assistant Message that only records a failed turn, for failures before the reply started. */
export const turnErrorMessageOf = (id: string, message: string): UIMessage => ({
  id,
  role: "assistant",
  parts: [turnErrorPart(message)],
});

/**
 * Writes the error into the reply right before the stream's error chunk, so both the client's
 * copy of the thread and the saved one keep it. A stream that throws instead of sending an error
 * chunk is turned into one here, so it gets the same record and mapped copy.
 */
export function keepTurnErrors(stream: ReadableStream<UIMessageChunk>): ReadableStream<UIMessageChunk> {
  const reader = stream.getReader();
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) return controller.close();
        if (value.type === "error") controller.enqueue(turnErrorPart(value.errorText));
        controller.enqueue(value);
      } catch (error) {
        console.error(error);
        const errorText = turnErrorMessage(error);
        controller.enqueue(turnErrorPart(errorText));
        controller.enqueue({ type: "error", errorText });
        controller.close();
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}
