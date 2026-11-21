/**
 * issue #4508 R1 — the `{ error }` code of a failed `supabase.functions.invoke`.
 *
 * supabase-js puts the raw fetch `Response` in `FunctionsHttpError.context`,
 * so the server's code lives in that response's unread body (`context.body`
 * is a stream, never the JSON). Reading `context.body` as JSON therefore lost
 * every refusal and the app showed "Couldn't save your RSVP. Try again." for
 * all of them. This reads the body the way Host and buyer web already do
 * (`mingla-business/src/services/rsvpErrorCodes.ts` `readRsvpErrorCode`): a
 * clone of the response when it can, so nothing else loses the body.
 *
 * Pure (no react-native, no supabase import) so it is Deno-testable against a
 * real `FunctionsHttpError`.
 */

const codeOf = (parsed: unknown): string | null => {
  if (parsed === null || typeof parsed !== "object") return null;
  const value = (parsed as { error?: unknown }).error;
  return typeof value === "string" && value.length > 0 ? value : null;
};

/**
 * The server's error code, or `fallback` when the error carries none
 * (a network failure, a relay error page, an already-read body).
 */
export const readInvokeErrorCode = async (
  error: unknown,
  fallback: string,
): Promise<string> => {
  const context = (error as { context?: unknown } | null)?.context;
  if (context === null || context === undefined || typeof context !== "object") {
    return fallback;
  }
  const response = context as {
    clone?: () => { text?: () => Promise<string> };
    text?: () => Promise<string>;
    body?: unknown;
  };
  try {
    // Inside the try: clone() throws when the body was already read.
    const readable = typeof response.clone === "function" ? response.clone() : response;
    if (typeof readable.text === "function") {
      const code = codeOf(JSON.parse(await readable.text()));
      if (code !== null) return code;
      return fallback;
    }
  } catch {
    // An unreadable or non-JSON body: the plain-body check below decides.
  }
  // A caller (or an older supabase-js) that already holds the parsed body.
  const body = response.body;
  try {
    const code = codeOf(typeof body === "string" ? JSON.parse(body) : body);
    if (code !== null) return code;
  } catch {
    // Not JSON: no code.
  }
  return fallback;
};
