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
  impact?: 'high' | 'medium'
}

// ─── Depth fields (all optional — hide gracefully when absent) ──────────────

export type SignalStatus = 'pass' | 'warn' | 'fail'
export interface SiteSignal {
  key: string
  label: string
  status: SignalStatus
  detail?: string
}
export interface GraderPercentile {
  city: string
  better_than_pct: number
  sample: number
}
export interface GraderReviewThemes {
  praise: string[]
  complaints: string[]
}
export interface GraderHeadToHeadRow {
  dimension: string
  you: string
  them: string
  winner: 'you' | 'them' | 'tie'
}
export interface GraderHeadToHead {
  competitor: string
  rows: GraderHeadToHeadRow[]
}

// ─── Competition (optional on the report — may be absent) ───────────────────

export type GraderCompetitionEffort = 'this_week' | 'this_month' | 'project'

export interface GraderCompetitor {
  name: string
  city: string
  website: string | null
  mingla_score: number | null
  /** 1–3 bullets on what this competitor does better. */
  what_they_do_better: string[]
  evidence: string | null
}

export interface GraderOutrankMove {
  move: string
  why_it_works: string
  effort: GraderCompetitionEffort
}

/** Head-to-head block — absent when the backend found no competitors. */
export interface GraderCompetition {
  /** Up to 4 competitors. */
  competitors: GraderCompetitor[]
  your_rank_read: string
  /** 3–5 moves to outrank them. */
  outrank_playbook: GraderOutrankMove[]
}

export type GraderCompetitionSource = 'pool+grounded' | 'pool_only' | 'none'

export interface GraderReport {
  venue: { name: string; city: string; website: string }
  match: {
    found: boolean
    mingla_score?: number
    ai_read?: string
    photo_urls?: string[]
  }
  screenshot: {
    image_url?: string | null
    og_image_url?: string | null
    after_url?: string | null
  }
  site_signals?: { checks: SiteSignal[] }
  percentile?: GraderPercentile
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
  competition?: GraderCompetition
  review_themes?: GraderReviewThemes
  head_to_head?: GraderHeadToHead
  where_you_win?: string[]
  offer?: { per_person_from: string }
  meta?: { fetch_failed?: boolean; competition_source?: GraderCompetitionSource }
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
  fn: 'growth-tools-run' | 'growth-tools-gate' | 'growth-tools-preview',
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ ok: true; body: unknown } | { ok: false; error: GrowthToolsError }> {
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
  // The venue's own origin so the backend builds the "after" screenshot against
  // the right deployment (prod or this preview). Server-side validated.
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined
  const result = await postGrowthTools(
    'growth-tools-run',
    {
      action: 'run',
      input,
      ...(opts?.pid ? { pid: opts.pid } : {}),
      ...(opts?.utm && Object.keys(opts.utm).length > 0 ? { utm: opts.utm } : {}),
      ...(origin ? { origin } : {}),
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

/** Storefront-render subset for the "after" homepage preview page. */
export interface VenuePreviewRender {
  name: string
  city: string
  tagline: string
  vibes: string[]
  occasions: string[]
  signature: string
  ai_read: string
  photos: string[]
}

/** Public render-data read for the redesigned-homepage preview (by run_id). */
export async function fetchVenuePreview(
  runId: string,
): Promise<{ ok: true; render: VenuePreviewRender } | { ok: false; error: GrowthToolsError }> {
  const result = await postGrowthTools('growth-tools-preview', { run_id: runId })
  if (!result.ok) return result
  const render =
    result.body && typeof result.body === 'object' && 'render' in result.body
      ? (result.body as { render?: VenuePreviewRender }).render
      : undefined
  if (!render || typeof render.name !== 'string') return { ok: false, error: 'server' }
  return { ok: true, render }
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
