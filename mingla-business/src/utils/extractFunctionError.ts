/**
 * Extract the real error message from a Supabase FunctionsHttpError.
 * Copied from app-mobile/src/utils/edgeFunctionError.ts — identical logic.
 */

const GENERIC_SDK_MESSAGE = "Edge Function returned a non-2xx status code";

export async function extractFunctionError(
  error: unknown,
  fallback: string
): Promise<string> {
  try {
    const err = error as Record<string, unknown> | null | undefined;
    if (!err) return fallback;

    const ctx = err.context;

    if (ctx && typeof (ctx as Response).text === "function") {
      try {
        const raw = await (ctx as Response).text();
        try {
          const body = JSON.parse(raw);
          if (body?.error && typeof body.error === "string") return body.error;
          if (body?.message && typeof body.message === "string")
            return body.message;
        } catch {
          if (raw && raw.length > 0 && raw.length < 200 && !raw.startsWith("<!")) {
            return raw;
          }
        }
      } catch {
        // Body stream couldn't be read
      }
    }

    const ctx2 = err.context as Record<string, unknown> | undefined;
    if (ctx2 && typeof (ctx2 as { status?: number }).status === "number") {
      const status = (ctx2 as { status: number }).status;
      if (status === 400) return `${fallback} (bad request)`;
      if (status === 401) return "Session expired — please sign in again";
      if (status === 403) return "Not authorized for this action";
      if (status === 404) return `${fallback} (not found)`;
      if (status === 429) return "Too many attempts — try again in a moment";
      if (status >= 500) return `${fallback} (server error)`;
    }

    const msg = err.message;
    if (
      typeof msg === "string" &&
      msg.length > 0 &&
      !msg.startsWith("Edge Function returned")
    ) {
      return msg;
    }
  } catch {
    // Defensive
  }

  return fallback;
}
