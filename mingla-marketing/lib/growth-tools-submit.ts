// #1003 [Venue Website Grader — growth tools, test cut] — client transport for
// the /tools surfaces.
//
// Thin, anon-safe POSTs to the public `growth-tools-run` + `growth-tools-gate`
// edge functions. The marketing app has NO Supabase client (no
// @supabase/supabase-js dependency), so this uses a raw `fetch` with the public
// anon key in the Authorization + apikey headers — mirroring the
// lib/unsubscribe-submit.ts transport pattern. The anon key is public by
// design: RLS denies anon writes and the edge fns write via the service role.
// The edge fns re-validate everything; this transport only shapes the calls.

// ─── Report contract (growth-tools-run {action:'run'}) ──────────────────────

export interface GrowthToolsSearchResult {
  id: string
  name: string
  city: string
  website: string
  photo_url?: string
}

export type GraderScoreKey =
  | 'first_impression'
  | 'findability'
  | 'mobile'
  | 'menu_offers'
  | 'occasion_signal'

export interface GraderScores {
  overall: number
  grade: string
  first_impression: number
  findability: number
  mobile: number
  menu_offers: number
  occasion_signal: number
  /** One reason line per score key (same keys as the numeric scores). */
  reasons: Partial<Record<GraderScoreKey, string>>
}

export interface GraderFix {
  title: string
  why: string
  change: string
}

export interface GraderReport {
  venue: { name: string; city: string; website: string }
  match: {
    found: boolean
    mingla_score?: number
    ai_read?: string
    photo_urls?: string[]
  }
  screenshot: { og_image_url?: string }
  vibe_card: {
    vibes: string[]
    occasions: string[]
    signature_mention: string
  }
  scores: GraderScores
  google_listing: { lines: string[] }
  fixes: GraderFix[]
  rewritten_hero: { before_excerpt: string; after_copy: string }
  ai_read: string
  meta?: { fetch_failed?: boolean }
}

export interface GraderRunInput {
  name: string
  city: string
  website: string
  place_id?: string
}

// ─── Result unions ──────────────────────────────────────────────────────────

export type GrowthToolsError =
  | 'rate_limited'
  | 'generation_failed'
  | 'validation'
  | 'server'
  | 'network'

export type GrowthToolsSearchResponse =
  | { ok: true; results: GrowthToolsSearchResult[] }
  | { ok: false; error: GrowthToolsError }

export type GrowthToolsRunResponse =
  | { ok: true; run_id: string; report: GraderReport }
  | { ok: false; error: GrowthToolsError }

export type GrowthToolsGateResponse =
  | { ok: true }
  | { ok: false; error: GrowthToolsError }

// ─── Transport ──────────────────────────────────────────────────────────────

const FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

const KNOWN_ERRORS: readonly GrowthToolsError[] = [
  'rate_limited',
  'generation_failed',
  'validation',
  'server',
  'network',
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

async function postGrowthTools(
  fn: 'growth-tools-run' | 'growth-tools-gate',
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ ok: true; body: unknown } | { ok: false; error: GrowthToolsError }> {
  if (!FUNCTIONS_URL || !ANON_KEY) {
    if (typeof console !== 'undefined') {
      console.error(
        '[growth-tools-submit] Missing NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL or ' +
          'NEXT_PUBLIC_SUPABASE_ANON_KEY — see mingla-marketing/.env.example',
      )
    }
    return { ok: false, error: 'network' }
  }

  let response: Response
  try {
    response = await fetch(`${FUNCTIONS_URL.replace(/\/$/, '')}/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
      },
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
  return { ok: false, error: mapErrorBody(response.status, body) }
}

/** Typeahead search: {action:'search'} → up to a handful of place matches. */
export async function searchGrowthToolsPlaces(
  q: string,
  city?: string,
  signal?: AbortSignal,
): Promise<GrowthToolsSearchResponse> {
  const result = await postGrowthTools(
    'growth-tools-run',
    { action: 'search', q, ...(city ? { city } : {}) },
    signal,
  )
  if (!result.ok) return result
  const results =
    result.body && typeof result.body === 'object' && 'results' in result.body
      ? (result.body as { results?: GrowthToolsSearchResult[] }).results
      : undefined
  if (!Array.isArray(results)) return { ok: false, error: 'server' }
  return { ok: true, results }
}

/** The run itself: {action:'run'} → {run_id, report}. Slow (LLM) — no timeout here. */
export async function runVenueGrader(
  input: GraderRunInput,
  opts?: { pid?: string; utm?: Record<string, string>; signal?: AbortSignal },
): Promise<GrowthToolsRunResponse> {
  const result = await postGrowthTools(
    'growth-tools-run',
    {
      action: 'run',
      input,
      ...(opts?.pid ? { pid: opts.pid } : {}),
      ...(opts?.utm && Object.keys(opts.utm).length > 0 ? { utm: opts.utm } : {}),
    },
    opts?.signal,
  )
  if (!result.ok) return result
  const body = result.body as { run_id?: string; report?: GraderReport } | null
  if (!body || typeof body.run_id !== 'string' || !body.report) {
    return { ok: false, error: 'server' }
  }
  return { ok: true, run_id: body.run_id, report: body.report }
}

/** Email gate: {run_id, email} → {ok:true} unlocks the report + emails it. */
export async function submitGrowthToolsGate(
  run_id: string,
  email: string,
  signal?: AbortSignal,
): Promise<GrowthToolsGateResponse> {
  const result = await postGrowthTools('growth-tools-gate', { run_id, email }, signal)
  if (!result.ok) return result
  const ok =
    result.body && typeof result.body === 'object' && 'ok' in result.body
      ? (result.body as { ok?: boolean }).ok
      : undefined
  if (ok !== true) return { ok: false, error: 'server' }
  return { ok: true }
}
