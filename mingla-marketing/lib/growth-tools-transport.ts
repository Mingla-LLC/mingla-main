// #4339 — the growth-tools transport, split out of lib/growth-tools-submit.ts
// (unchanged) so Book a call (lib/booking-call.ts) can use it without loading
// every free tool's client code on /schedule (the first-load budget).

export type GrowthToolsError =
  | 'rate_limited'
  | 'generation_failed'
  | 'validation'
  | 'server'
  | 'network'
  | 'booking_unconfigured'
  | 'slot_taken'
  | 'calendar_unavailable'

// Default = the public prod functions host from .env.example. NEXT_PUBLIC_*
// vars are inlined at BUILD time and Vercel preview builds don't carry the
// production env scope — without this default every preview build ships an
// empty URL and the tool dies silently (proven on PR #1025's preview).
const FUNCTIONS_URL =
  process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ??
  'https://gqnoajqerqhnvulmnyvv.functions.supabase.co'
// Both growth-tools fns are verify_jwt=false public endpoints — auth headers
// are optional. Sent only when the anon key is present in the build env.
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

const KNOWN_ERRORS: readonly GrowthToolsError[] = [
  'rate_limited',
  'generation_failed',
  'validation',
  'server',
  'network',
  'booking_unconfigured',
  'slot_taken',
  'calendar_unavailable',
]

function mapErrorBody(status: number, body: unknown): GrowthToolsError {
  const raw =
    body && typeof body === 'object' && 'error' in body
      ? (body as { error?: unknown }).error
      : undefined
  if (typeof raw === 'string' && (KNOWN_ERRORS as readonly string[]).includes(raw)) {
    return raw as GrowthToolsError
  }
  if (status === 429) return 'rate_limited'
  if (status >= 400 && status < 500) return 'validation'
  return 'server'
}

export async function postGrowthTools(
  fn:
    | 'growth-tools-run'
    | 'growth-tools-events'
    | 'growth-tools-trips'
    | 'growth-tools-pricing'
    | 'growth-tools-geocode'
    | 'growth-tools-gate'
    | 'growth-tools-preview'
    | 'growth-tools-report'
    | 'growth-tools-book',
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ ok: true; body: unknown } | { ok: false; error: GrowthToolsError; body?: unknown }> {
  let response: Response
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (ANON_KEY) {
      headers.Authorization = `Bearer ${ANON_KEY}`
      headers.apikey = ANON_KEY
    }
    response = await fetch(`${FUNCTIONS_URL.replace(/\/$/, '')}/${fn}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    })
  } catch (err) {
    // A caller-driven abort (debounced search superseded) is not a failure.
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return { ok: false, error: 'network' }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON body — fall through; error mapping handles it by status.
  }

  if (response.ok) return { ok: true, body }
  return { ok: false, error: mapErrorBody(response.status, body), body }
}

