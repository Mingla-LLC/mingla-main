/**
 * Extract the real error message from a Supabase FunctionsHttpError on the admin client.
 *
 * supabase-js v2 wraps non-2xx edge-function responses in a FunctionsHttpError whose
 * `.message` is the generic string "Edge Function returned a non-2xx status code". The
 * actual response is stored as `error.context` (a Response object).
 *
 * IMPORTANT: read the body as TEXT first, then JSON.parse. A Response body can only be
 * consumed once — if .json() fails mid-stream, .text() will also fail. text-first is safe.
 *
 * Duck-type Response (`typeof .text === 'function'`); do not rely on `instanceof Response`.
 *
 * Returns a Promise<string> — the extracted message, or the fallback if extraction fails.
 * Never throws.
 *
 * Mirrors app-mobile/src/utils/edgeFunctionError.ts (ORCH-0686).
 */

export async function extractFunctionError(error, fallback) {
  try {
    if (!error) return fallback;

    const ctx = error.context;

    // Strategy 1: read Response body as text, then parse as JSON.
    if (ctx && typeof ctx.text === "function") {
      try {
        const raw = await ctx.text();
        try {
          const body = JSON.parse(raw);
          if (body?.error && typeof body.error === "string") return body.error;
          if (body?.message && typeof body.message === "string") return body.message;
          if (body?.msg && typeof body.msg === "string") return body.msg;
        } catch {
          // Not JSON — return short raw text if present and not HTML.
          if (raw && raw.length > 0 && raw.length < 500 && !raw.startsWith("<!")) {
            return raw;
          }
        }
      } catch {
        // Body stream couldn't be read — fall through.
      }
    }

    // Strategy 2: HTTP-status-derived message when body is unavailable.
    if (ctx && typeof ctx.status === "number") {
      const status = ctx.status;
      if (status === 400) return `${fallback} (bad request)`;
      if (status === 401) return "Session expired — please sign in again";
      if (status === 403) return "Not authorized for this action";
      if (status === 404) return `${fallback} (not found)`;
      if (status === 429) return "Too many requests — try again in a moment";
      if (status >= 500) return `${fallback} (server error)`;
    }

    // Strategy 3: error.message if not the generic SDK string.
    const msg = error.message;
    if (typeof msg === "string" && msg.length > 0 && !msg.startsWith("Edge Function returned")) {
      return msg;
    }
  } catch {
    // Defensive — anything unexpected falls through.
  }

  return fallback;
}
