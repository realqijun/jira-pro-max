/** Plain-text bodies the chat route returns; the dock maps them to friendly copy. */
export const ASSISTANT_NOT_CONFIGURED = "ASSISTANT_NOT_CONFIGURED";
export const ASSISTANT_LIMIT_REACHED = "ASSISTANT_LIMIT_REACHED";

/** Friendly copy for the route's plain-text bodies. */
export const ASSISTANT_ERROR_TEXT: Record<string, string> = {
  [ASSISTANT_NOT_CONFIGURED]: "The Assistant is not configured. Set OPENAI_API_KEY to enable it.",
  [ASSISTANT_LIMIT_REACHED]: "You have reached today's Assistant limit. It resets at midnight UTC.",
};

/**
 * Data part name for a failed turn. The route writes it into the reply so the error stays in the
 * thread after a reload; the model never sees data parts.
 */
export const TURN_ERROR = "turn_error";
export const TURN_ERROR_PART = `data-${TURN_ERROR}` as const;
export type TurnErrorData = { message: string };
