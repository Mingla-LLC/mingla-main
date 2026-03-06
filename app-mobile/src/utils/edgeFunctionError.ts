/**
 * Extract the real error message from a Supabase FunctionsHttpError.
 *
 * supabase-js v2 wraps non-2xx edge-function responses in a
 * FunctionsHttpError whose `.message` is the generic string
 * "Edge Function returned a non-2xx status code".
 * The actual response is stored as `error.context` (a Response object).
 *
 * IMPORTANT: We read the body as TEXT first, then parse as JSON.
 * A Response body can only be consumed once — if .json() fails mid-stream,
 * .text() will also fail. Reading as text first is always safe.
 *
 * We use duck-typing (`typeof .text === 'function'`) instead of
 * `instanceof Response` because React Native polyfills can break
 * the instanceof check across JS realms.
 */

const GENERIC_SDK_MESSAGE = 'Edge Function returned a non-2xx status code'

export async function extractFunctionError(
  error: unknown,
  fallback: string,
): Promise<string> {
  try {
    const err = error as Record<string, unknown> | null | undefined
    if (!err) return fallback

    const ctx = err.context

    // Strategy 1: Read the Response body as text, then parse as JSON
    if (ctx && typeof (ctx as Response).text === 'function') {
      try {
        const raw = await (ctx as Response).text()

        // Try parsing as JSON
        try {
          const body = JSON.parse(raw)
          if (body?.error && typeof body.error === 'string') return body.error
          if (body?.message && typeof body.message === 'string') return body.message
          if (body?.msg && typeof body.msg === 'string') return body.msg
        } catch {
          // Not JSON — use raw text if it's short and not HTML
          if (raw && raw.length > 0 && raw.length < 200 && !raw.startsWith('<!')) {
            return raw
          }
        }
      } catch {
        // Body stream couldn't be read — fall through
      }
    }

    // Strategy 2: Use HTTP status code for a meaningful message when body is unavailable
    const ctx2 = err.context as Record<string, unknown> | undefined
    if (ctx2 && typeof (ctx2 as any).status === 'number') {
      const status = (ctx2 as any).status as number
      if (status === 400) return `${fallback} (bad request)`
      if (status === 401) return 'Session expired — please sign in again'
      if (status === 403) return 'Not authorized for this action'
      if (status === 404) return `${fallback} (not found)`
      if (status === 429) return 'Too many requests — try again in a moment'
      if (status >= 500) return `${fallback} (server error)`
    }

    // Strategy 3: Check if error.message is meaningful (not the generic SDK message)
    const msg = err.message
    if (
      typeof msg === 'string' &&
      msg.length > 0 &&
      !msg.startsWith('Edge Function returned')
    ) {
      return msg
    }
  } catch {
    // Defensive: if anything unexpected happens, fall through
  }

  return fallback
}
