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
  | 'booking_unconfigured'
  | 'slot_taken'
  | 'calendar_unavailable'

export interface BookingSlot {
  start: string
  end: string
}

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

async function postGrowthTools(
  fn:
    | 'growth-tools-run'
    | 'growth-tools-events'
    | 'growth-tools-trips'
    | 'growth-tools-geocode'
    | 'growth-tools-gate'
    | 'growth-tools-preview'
    | 'growth-tools-report'
    | 'growth-tools-book',
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

/** Email gate: {run_id, email} → {ok:true}. Sends a summary email with a
 *  tokenized link; does NOT unlock the page (the full report opens from email). */
export async function submitGrowthToolsGate(
  run_id: string,
  email: string,
  signal?: AbortSignal,
): Promise<GrowthToolsGateResponse> {
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined
  const result = await postGrowthTools(
    'growth-tools-gate',
    { run_id, email, ...(origin ? { origin } : {}) },
    signal,
  )
  if (!result.ok) return result
  const ok =
    result.body && typeof result.body === 'object' && 'ok' in result.body
      ? (result.body as { ok?: boolean }).ok
      : undefined
  if (ok !== true) return { ok: false, error: 'server' }
  return { ok: true }
}

/** Token-gated full report (from the emailed link): {run_id, token} → {report}. */
export async function fetchFullReport(
  run_id: string,
  token: string,
): Promise<{ ok: true; report: GraderReport } | { ok: false; error: GrowthToolsError }> {
  const result = await postGrowthTools('growth-tools-report', { run_id, token })
  if (!result.ok) return result
  const report =
    result.body && typeof result.body === 'object' && 'report' in result.body
      ? (result.body as { report?: GraderReport }).report
      : undefined
  if (!report || typeof report.venue !== 'object') return { ok: false, error: 'server' }
  return { ok: true, report }
}

/** Available call slots on seth@usemingla.com's calendar. */
export async function fetchBookingSlots(): Promise<
  { ok: true; slots: BookingSlot[] } | { ok: false; error: GrowthToolsError }
> {
  const result = await postGrowthTools('growth-tools-book', { action: 'slots' })
  if (!result.ok) return result
  const slots =
    result.body && typeof result.body === 'object' && 'slots' in result.body
      ? (result.body as { slots?: BookingSlot[] }).slots
      : undefined
  if (!Array.isArray(slots)) return { ok: false, error: 'server' }
  return { ok: true, slots }
}

/** Book a call: creates the event + Meet link and emails the invite. */
export async function bookCall(input: {
  start: string
  name: string
  email: string
  venue?: string
  report_url?: string
}): Promise<
  | { ok: true; event_url: string | null; meet_url: string | null; start: string }
  | { ok: false; error: GrowthToolsError }
> {
  const result = await postGrowthTools('growth-tools-book', {
    action: 'book',
    ...input,
  })
  if (!result.ok) return result
  const b = result.body as
    | { ok?: boolean; event_url?: string | null; meet_url?: string | null; start?: string }
    | null
  if (!b || b.ok !== true || typeof b.start !== 'string') {
    return { ok: false, error: 'server' }
  }
  return { ok: true, event_url: b.event_url ?? null, meet_url: b.meet_url ?? null, start: b.start }
}

// ─── Event Turnout Predictor (#1004) ─────────────────────────────────────────

export interface EventRunInput {
  title: string
  category: string
  city: string
  venue_name: string
  date: string // YYYY-MM-DD
  start_time: string // HH:MM
  indoor_outdoor: 'indoor' | 'outdoor' | 'mixed'
  ticket_price: number
  capacity: number
  budget: number
  audience_size: number | null
  lineup: string | null
  currency: string
}

export interface EventForecast {
  total_low: number
  total_high: number
  baseline_low: number
  baseline_high: number
  capacity: number
  pct_capacity_low: number
  pct_capacity_high: number
  confidence: 'low' | 'medium' | 'high'
  headline_read: string
}
export interface EventFreePlan {
  kind: 'free_budget'
  currency: string
  budget: number
  cpc: number
  cpc_source: 'researched' | 'estimated'
  benchmarks: { cpc: number; landing_to_rsvp_pct: number; show_rate_pct: number }
  clicks_low: number
  clicks_high: number
  attendees_low: number
  attendees_high: number
  cost_per_attendee_low: number | null
  cost_per_attendee_high: number | null
  read: string
}
export interface EventScenario {
  label: string
  budget: number
  ad_tickets: number
  revenue: number
  profit: number
  roas: number | null
  cost_per_ticket: number | null
  total_attendees: number
  pct_capacity: number
  recommended: boolean
}
export interface EventProfitPlan {
  kind: 'paid_optimized'
  currency: string
  ticket_price: number
  cpc: number
  cpc_source: 'researched' | 'estimated'
  benchmarks: { cpc: number; landing_to_ticket_pct: number; show_rate_pct: number }
  recommended_budget: number
  ad_tickets_low: number
  ad_tickets_high: number
  ad_attendees_low: number
  ad_attendees_high: number
  cost_per_ticket: number | null
  cost_pct_of_ticket: number | null
  ad_revenue: number
  ad_profit: number
  roas: number | null
  ads_worth_it: boolean
  scenarios?: EventScenario[]
  read: string
}
export type EventPlan = EventFreePlan | EventProfitPlan
export interface EventFactor {
  key?: string
  label: string
  status: 'help' | 'watch' | 'hurt'
  detail: string
}
export interface EventCompetitor {
  name: string
  platform: string
  date_note: string
  scale_note: string
}
export interface EventComparable {
  name: string
  city: string
  turnout_note: string
  source_note: string
}
export interface EventWeather {
  summary: string
  impact: string
  kind: 'forecast' | 'climate_normal' | 'seasonal'
}
export interface EventFix {
  title: string
  why: string
  change: string
  lift_note: string
  effort: 'this_week' | 'this_month' | 'project'
}
export interface EventListingPreview {
  title: string
  tagline: string
  vibe_tags: string[]
  why_go: string[]
  best_for: string[]
  cover_url?: string
}
export interface EventReport {
  event: {
    title: string
    category: string
    city: string
    venue_name: string
    date: string
    start_time: string
    indoor_outdoor: string
    ticket_price: number
    capacity: number
    currency: string
    audience_size: number | null
    lineup: string | null
  }
  forecast: EventForecast
  plan: EventPlan
  factors: EventFactor[]
  competitors: EventCompetitor[]
  comparables: EventComparable[]
  weather?: EventWeather
  demand_read: string
  fixes: EventFix[]
  listing_preview: EventListingPreview
  offer?: { per_person_from: string }
  narrative: string
  meta?: { generated_at?: string; model?: string; research_source?: 'grounded' | 'fallback' }
}

export type EventRunResponse =
  | { ok: true; run_id: string; report: EventReport }
  | { ok: false; error: GrowthToolsError }

/** City autocomplete for the event intake — validates the city against Mapbox. */
export interface CitySuggestion {
  label: string
  city: string
  region: string
  country: string
}
export async function searchCities(
  q: string,
  signal?: AbortSignal,
): Promise<{ ok: true; cities: CitySuggestion[] } | { ok: false; error: GrowthToolsError }> {
  const result = await postGrowthTools('growth-tools-geocode', { q }, signal)
  if (!result.ok) return result
  const cities =
    result.body && typeof result.body === 'object' && 'cities' in result.body
      ? (result.body as { cities?: CitySuggestion[] }).cities
      : undefined
  if (!Array.isArray(cities)) return { ok: false, error: 'server' }
  return { ok: true, cities }
}

/** The event forecast run: {action:'run', input} → {run_id, report}. Slow (LLM + search). */
export async function runEventPredictor(
  input: EventRunInput,
  opts?: { pid?: string; utm?: Record<string, string>; signal?: AbortSignal },
): Promise<EventRunResponse> {
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined
  const result = await postGrowthTools(
    'growth-tools-events',
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
  const body = result.body as { run_id?: string; report?: EventReport } | null
  if (!body || typeof body.run_id !== 'string' || !body.report) {
    return { ok: false, error: 'server' }
  }
  return { ok: true, run_id: body.run_id, report: body.report }
}

/** Token-gated full event report (from the emailed link): {run_id, token} → {report}. */
export async function fetchEventReport(
  run_id: string,
  token: string,
): Promise<{ ok: true; report: EventReport } | { ok: false; error: GrowthToolsError }> {
  const result = await postGrowthTools('growth-tools-report', { run_id, token })
  if (!result.ok) return result
  const report =
    result.body && typeof result.body === 'object' && 'report' in result.body
      ? (result.body as { report?: EventReport }).report
      : undefined
  if (!report || typeof report.event !== 'object') return { ok: false, error: 'server' }
  return { ok: true, report }
}

/** Public render-data for the "as a Mingla listing" event preview (by run_id). */
export interface EventPreviewRender {
  kind: 'event'
  title: string
  tagline: string
  city: string
  venue_name: string
  category: string
  date: string
  start_time: string
  vibe_tags: string[]
  why_go: string[]
  best_for: string[]
  cover_url?: string
  ticket_price?: number
  currency?: string
}
export async function fetchEventPreview(
  runId: string,
): Promise<{ ok: true; render: EventPreviewRender } | { ok: false; error: GrowthToolsError }> {
  const result = await postGrowthTools('growth-tools-preview', { run_id: runId })
  if (!result.ok) return result
  const render =
    result.body && typeof result.body === 'object' && 'render' in result.body
      ? (result.body as { render?: EventPreviewRender }).render
      : undefined
  if (!render || typeof render.title !== 'string') return { ok: false, error: 'server' }
  return { ok: true, render }
}

// ─── Quote Any Trip (#1005) ──────────────────────────────────────────────────

export type TripVibe = 'budget' | 'balanced' | 'luxury'

export interface TripRunInput {
  title: string
  destination: string
  departure: string
  start_date: string // YYYY-MM-DD
  nights: number
  group_size: number
  vibe: TripVibe
  vibe_note: string | null
  includes: { stay: boolean; activities: boolean; meals: boolean; transport: boolean }
  currency: string
}

export interface TripCostLine {
  key: string
  label: string
  per_person: number
  basis: string
}
export interface TripMarginTier {
  margin_pct: number
  price_per_person: number
  profit_per_person: number
  group_profit: number
  recommended: boolean
}
export interface TripScenario {
  label: string
  budget: number
  ad_bookings: number
  extra_profit: number
  cost_per_booking: number | null
  total_booked: number
  pct_full: number
  recommended: boolean
}
export interface TripPricingPlan {
  currency: string
  nights: number
  days: number
  group_size: number
  cost_lines: TripCostLine[]
  cost_per_person: number
  cost_per_person_low: number
  cost_per_person_high: number
  group_cost: number
  margin_tiers: TripMarginTier[]
  recommended_margin_pct: number
  recommended_price_per_person: number
  price_per_person_low: number
  price_per_person_high: number
  group_price: number
  profit_per_person: number
  group_profit: number
  comparable_price_pp: number | null
  price_vs_market: string
  organic_bookings_low: number
  organic_bookings_high: number
  cpc: number
  cpc_source: 'researched' | 'estimated'
  recommended_ad_budget: number
  ad_bookings_low: number
  ad_bookings_high: number
  ad_extra_profit: number
  ads_worth_it: boolean
  scenarios: TripScenario[]
  read: string
}
export interface TripItineraryDay {
  day: number
  title: string
  summary: string
  stay: string
  activities: string[]
}
export interface TripHotel {
  name: string
  area: string
  nightly_pp: number | null
  note: string
}
export interface TripActivity {
  name: string
  price_pp: number | null
  note: string
}
export interface TripComparable {
  name: string
  operator: string
  price_pp: number | null
  note: string
}
export interface TripFactor {
  key?: string
  label: string
  status: 'help' | 'watch' | 'hurt'
  detail: string
}
export interface TripFix {
  title: string
  why: string
  change: string
  lift_note: string
  effort: 'this_week' | 'this_month' | 'project'
}
export interface TripListingPreview {
  title: string
  tagline: string
  vibe_tags: string[]
  why_go: string[]
  best_for: string[]
  included: string[]
  excluded: string[]
  cover_url?: string
}
export interface TripReport {
  trip: {
    title: string
    destination: string
    departure: string
    start_date: string
    nights: number
    days: number
    date_range: string
    group_size: number
    vibe: TripVibe
    vibe_note: string | null
    currency: string
  }
  headline_read: string
  cover_narrative: string
  confidence: 'low' | 'medium' | 'high'
  plan: TripPricingPlan
  itinerary: TripItineraryDay[]
  hotels: TripHotel[]
  activities: TripActivity[]
  comparables: TripComparable[]
  weather?: EventWeather
  demand_read: string
  factors: TripFactor[]
  fixes: TripFix[]
  listing_preview: TripListingPreview
  price_basis: { note: string; checked_on: string }
  offer?: { per_person_from: string }
  meta?: { generated_at?: string; model?: string; research_source?: 'grounded' | 'fallback' }
}

export type TripRunResponse =
  | { ok: true; run_id: string; report: TripReport }
  | { ok: false; error: GrowthToolsError }

/** The trip quote run: {action:'run', input} → {run_id, report}. Slow (LLM + search). */
export async function runTripQuoter(
  input: TripRunInput,
  opts?: { pid?: string; utm?: Record<string, string>; signal?: AbortSignal },
): Promise<TripRunResponse> {
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined
  const result = await postGrowthTools(
    'growth-tools-trips',
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
  const body = result.body as { run_id?: string; report?: TripReport } | null
  if (!body || typeof body.run_id !== 'string' || !body.report) {
    return { ok: false, error: 'server' }
  }
  return { ok: true, run_id: body.run_id, report: body.report }
}

/** Token-gated full trip report (from the emailed link): {run_id, token} → {report}. */
export async function fetchTripReport(
  run_id: string,
  token: string,
): Promise<{ ok: true; report: TripReport } | { ok: false; error: GrowthToolsError }> {
  const result = await postGrowthTools('growth-tools-report', { run_id, token })
  if (!result.ok) return result
  const report =
    result.body && typeof result.body === 'object' && 'report' in result.body
      ? (result.body as { report?: TripReport }).report
      : undefined
  if (!report || typeof report.trip !== 'object') return { ok: false, error: 'server' }
  return { ok: true, report }
}

/** Public render-data for the "as a Mingla trip page" preview (by run_id). */
export interface TripPreviewRender {
  kind: 'trip'
  title: string
  tagline: string
  cover_url?: string
  destination: string
  departure: string
  date_range: string
  nights: number
  days: number
  group_size: number
  price_per_person: number
  currency: string
  vibe_tags: string[]
  why_go: string[]
  best_for: string[]
  included: string[]
  excluded: string[]
  itinerary: TripItineraryDay[]
}
export async function fetchTripPreview(
  runId: string,
): Promise<{ ok: true; render: TripPreviewRender } | { ok: false; error: GrowthToolsError }> {
  const result = await postGrowthTools('growth-tools-preview', { run_id: runId })
  if (!result.ok) return result
  const render =
    result.body && typeof result.body === 'object' && 'render' in result.body
      ? (result.body as { render?: TripPreviewRender }).render
      : undefined
  if (!render || typeof render.title !== 'string') return { ok: false, error: 'server' }
  return { ok: true, render }
}
