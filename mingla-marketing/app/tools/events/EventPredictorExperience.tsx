'use client'
// #1004 [Event Turnout Predictor] — the client state machine: intake → running
// → report.
//
// INTAKE — a pure, validated event form (no DB search; a fresh event isn't in
// any catalogue). RUNNING — progress theater while the run does live external
// research + the budget engine + synthesis (~15-30s). REPORT — the parchment
// document (EventReportView), gated behind an emailed link like the grader.

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { buttonClasses } from '@/components/ui/button'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { detectClientPlatform } from '@/lib/device-platform'
import { BUSINESS_ONELINK_URL, BUSINESS_WEB_URL } from '@/lib/store-links'
import {
  runEventPredictor,
  searchCities,
  type CitySuggestion,
  type EventReport,
  type EventRunInput,
  type GrowthToolsError,
} from '@/lib/growth-tools-submit'
import { EventReportView } from './EventReportView'

type Phase = 'intake' | 'running' | 'report'
type InOut = 'indoor' | 'outdoor' | 'mixed'

function collectUtm(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const utm: Record<string, string> = {}
  new URLSearchParams(window.location.search).forEach((value, key) => {
    if (key.toLowerCase().startsWith('utm_') && value) utm[key.toLowerCase()] = value
  })
  return utm
}

const MICRO_LABEL =
  'block text-xs font-semibold uppercase tracking-[0.16em] text-white/60'
const FIELD =
  'min-h-12 w-full rounded-2xl border border-white/14 bg-black/30 px-4 text-base text-white placeholder:text-white/35 focus-ring'

const CATEGORIES = [
  'Club night / DJ',
  'Concert / live music',
  'Comedy',
  'Festival',
  'Workshop / class',
  'Food & drink',
  'Arts & culture',
  'Sports / fitness',
  'Community / social',
  'Conference / talk',
  'Other',
]
const CURRENCIES = ['USD', 'GBP', 'EUR', 'NGN', 'CAD', 'AUD', 'AED', 'ZAR', 'INR', 'NZD']

const THEATER_LINES = [
  'Scanning what else is on that night',
  'Pulling turnout benchmarks for events like yours',
  'Checking the forecast for your date',
  'Pricing event ads in your city',
  'Running your budget through our conversion brain',
  'Writing your forecast',
] as const

function RunningTheater({
  title,
  error,
  onRetry,
  onBack,
}: {
  title: string
  error: GrowthToolsError | null
  onRetry: () => void
  onBack: () => void
}) {
  const [revealed, setRevealed] = useState(0)
  useEffect(() => {
    if (error) return
    if (revealed >= THEATER_LINES.length) return
    const timer = setTimeout(
      () => setRevealed((c) => Math.min(c + 1, THEATER_LINES.length)),
      revealed === 0 ? 400 : 3200,
    )
    return () => clearTimeout(timer)
  }, [revealed, error])

  // Device-aware "create your event" target — desktop → business web, mobile → app.
  const [appHref, setAppHref] = useState(BUSINESS_WEB_URL)
  useEffect(() => {
    const p = detectClientPlatform()
    if (p === 'ios' || p === 'android') {
      setAppHref(`${BUSINESS_ONELINK_URL}?pid=tool_events&c=tool_events`)
    }
  }, [])

  if (error) {
    const rateLimited = error === 'rate_limited'
    return (
      <div className="rounded-md glass-soft p-6 md:p-8" role="alert">
        <p className="font-display text-2xl text-white">
          {rateLimited ? 'You’ve used your free forecasts for today' : 'That didn’t work — try again'}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-white/70 md:text-base">
          {rateLimited
            ? 'That’s your free forecasts used up for today — come back tomorrow, or create your event on the Mingla app now to see full turnout insights as it fills.'
            : 'Something broke while building your forecast. Give it another go — it usually works the second time.'}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {rateLimited ? (
            <a
              href={appHref}
              onClick={() => captureMarketing('tool_ratelimit_cta_click', { tool: 'events' })}
              className={buttonClasses({ variant: 'primary' })}
            >
              Create your event on Mingla
            </a>
          ) : (
            <button type="button" onClick={onRetry} className={buttonClasses({ variant: 'primary' })}>
              Try again
            </button>
          )}
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-11 items-center rounded-full border border-white/14 bg-white/8 px-5 text-sm font-semibold text-text-secondary transition hover:bg-white/12 hover:text-text-primary focus-ring"
          >
            Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md glass-soft p-6 md:p-8">
      <p className="font-display text-2xl text-white md:text-3xl">
        Forecasting <span className="break-words text-warm">{title}</span>…
      </p>
      <ul className="mt-6 space-y-3" aria-live="polite">
        {THEATER_LINES.slice(0, Math.max(revealed, 1)).map((line, i) => {
          const isActive = i === Math.max(revealed, 1) - 1
          return (
            <li key={line} className="flex items-center gap-3 text-sm text-white/80 md:text-base">
              {isActive ? (
                <span aria-hidden="true" className="size-2 shrink-0 animate-pulse rounded-full bg-warm" />
              ) : (
                <span aria-hidden="true" className="shrink-0 font-semibold text-warm">✓</span>
              )}
              <span className={cn(isActive ? 'text-white' : 'text-white/60')}>{line}…</span>
            </li>
          )
        })}
      </ul>
      <p className="mt-6 text-xs text-white/45">
        This takes 20–30 seconds — we research your date, city and competition live.
      </p>
    </div>
  )
}

export function EventPredictorExperience({ embedded = false }: { readonly embedded?: boolean } = {}) {
  const [phase, setPhase] = useState<Phase>('intake')

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [city, setCity] = useState('')
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([])
  const [citySearching, setCitySearching] = useState(false)
  const [cityFocused, setCityFocused] = useState(false)
  const [cityChosen, setCityChosen] = useState(false)
  const [geocodeDown, setGeocodeDown] = useState(false)
  const cityAbort = useRef<AbortController | null>(null)
  const [venue, setVenue] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('20:00')
  const [inout, setInout] = useState<InOut>('indoor')
  const [isFree, setIsFree] = useState(false)
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [capacity, setCapacity] = useState('')
  const [budget, setBudget] = useState('')
  const [audience, setAudience] = useState('')
  const [lineup, setLineup] = useState('')

  const [runError, setRunError] = useState<GrowthToolsError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [runId, setRunId] = useState<string | null>(null)
  const [report, setReport] = useState<EventReport | null>(null)

  // Debounced city autocomplete (validates the city against Mapbox). Skips while
  // a suggestion is already chosen; degrades to free text if the geocoder is down.
  useEffect(() => {
    const q = city.trim()
    if (cityChosen || q.length < 2) {
      setCitySuggestions([])
      setCitySearching(false)
      return
    }
    setCitySearching(true)
    const timer = setTimeout(async () => {
      cityAbort.current?.abort()
      const controller = new AbortController()
      cityAbort.current = controller
      try {
        const res = await searchCities(q, controller.signal)
        if (controller.signal.aborted) return
        setCitySearching(false)
        if (res.ok) {
          setCitySuggestions(res.cities)
          setGeocodeDown(false)
        } else {
          setCitySuggestions([])
          if (res.error === 'network' || res.error === 'server') setGeocodeDown(true)
        }
      } catch {
        // superseded by a newer keystroke
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [city, cityChosen])

  function selectCity(hit: CitySuggestion) {
    const value = hit.country
      ? `${hit.city}, ${hit.country}`
      : hit.region
        ? `${hit.city}, ${hit.region}`
        : hit.city
    setCity(value)
    setCityChosen(true)
    setCitySuggestions([])
    setCitySearching(false)
  }

  // LOCAL today (not UTC) — toISOString() is UTC and rolls a day early for
  // anyone ahead of UTC, which silently failed "date >= today" on valid
  // same-day events and greyed out the button with no explanation.
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= todayStr
  const capacityNum = Number(capacity)
  const capacityValid = Number.isFinite(capacityNum) && capacityNum >= 1
  // The autocomplete validates the city, but a typed city is accepted too — so
  // it's a helpful assist, never a hard gate that silently blocks the button.
  const cityValid = cityChosen || city.trim().length >= 2
  const showCityDropdown =
    cityFocused && !cityChosen && city.trim().length >= 2 &&
    (citySearching || citySuggestions.length > 0)

  // Everything still required — surfaced under the button so a disabled state
  // is never a mystery.
  const missing: string[] = []
  if (title.trim().length < 2) missing.push('event name')
  if (category.trim().length < 2) missing.push('event type')
  if (!cityValid) missing.push('city')
  if (!dateValid) missing.push('a date (today or later)')
  if (!capacityValid) missing.push('capacity')
  const canRun = missing.length === 0

  async function handleRun() {
    if (!canRun) return
    captureMarketing('tool_run_started', { tool: 'events' })
    setRunError(null)
    setAttempt((n) => n + 1)
    setPhase('running')
    const input: EventRunInput = {
      title: title.trim(),
      category: category.trim(),
      city: city.trim(),
      venue_name: venue.trim(),
      date,
      start_time: startTime || '20:00',
      indoor_outdoor: inout,
      ticket_price: isFree ? 0 : Math.max(0, Number(price) || 0),
      capacity: Math.round(capacityNum),
      // Budget only applies to FREE events; paid events get a recommended budget.
      budget: isFree ? Math.max(0, Number(budget) || 0) : 0,
      audience_size: audience.trim() ? Math.max(0, Math.round(Number(audience) || 0)) : null,
      lineup: lineup.trim() || null,
      currency,
    }
    const res = await runEventPredictor(input, { pid: 'tool_events', utm: collectUtm() })
    if (res.ok) {
      setRunId(res.run_id)
      setReport(res.report)
      captureMarketing('tool_report_ready', { tool: 'events', run_id: res.run_id })
      setPhase('report')
      return
    }
    setRunError(res.error)
  }

  // ── REPORT ──────────────────────────────────────────────────────────────
  if (phase === 'report' && report && runId) {
    return (
      <div className={embedded ? 'p-0' : 'px-4 py-10 sm:px-6 md:px-10 md:py-16 [padding-left:max(1rem,env(safe-area-inset-left))] [padding-right:max(1rem,env(safe-area-inset-right))]'}>
        <div className="mx-auto max-w-3xl">
          <button
            type="button"
            onClick={() => {
              setPhase('intake')
              setReport(null)
              setRunId(null)
            }}
            className="mb-6 inline-flex min-h-10 items-center rounded-full border border-white/12 bg-white/8 px-4 text-sm font-semibold text-text-secondary transition hover:bg-white/12 hover:text-text-primary focus-ring"
          >
            ← Forecast another event
          </button>
          <EventReportView report={report} runId={runId} />
        </div>
      </div>
    )
  }

  // ── RUNNING ─────────────────────────────────────────────────────────────
  if (phase === 'running') {
    return (
      <div className={embedded ? 'p-0' : 'px-6 py-16 md:px-10 md:py-24 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))]'}>
        <div className="mx-auto max-w-xl">
          <RunningTheater
            key={attempt}
            title={title.trim() || 'your event'}
            error={runError}
            onRetry={handleRun}
            onBack={() => {
              setRunError(null)
              setPhase('intake')
            }}
          />
        </div>
      </div>
    )
  }

  // ── INTAKE ──────────────────────────────────────────────────────────────
  return (
    <div className={embedded ? 'p-0' : 'px-6 py-14 md:px-10 md:py-20 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))]'}>
      <div className="mx-auto max-w-2xl">
        <span className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm">
          Event Turnout Predictor
        </span>
        {embedded ? (
          <h3 className="mt-4 font-display text-4xl leading-[1.08] tracking-[-0.02em] text-white md:text-5xl">How many people will actually show up?</h3>
        ) : (
          <h1 className="mt-4 font-display text-4xl leading-[1.08] tracking-[-0.02em] text-white md:text-5xl">How many people will actually show up?</h1>
        )}
        <p className="mt-4 max-w-xl text-base leading-relaxed text-white/72 md:text-lg">
          Get a real turnout forecast — and see exactly what your promo budget can
          buy. Free, grounded in live research on your date, city and competition.
        </p>

        <div className="mt-10 space-y-5 rounded-md glass-soft p-5 sm:p-6 md:p-8">
          <div>
            <label htmlFor="ev-title" className={MICRO_LABEL}>
              Event name <span aria-hidden="true" className="text-warm">*</span>
            </label>
            <input
              id="ev-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Afrobeats Rooftop Summer Party"
              className={cn(FIELD, 'mt-2')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ev-category" className={MICRO_LABEL}>
                Type <span aria-hidden="true" className="text-warm">*</span>
              </label>
              <select
                id="ev-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={cn(FIELD, 'mt-2 appearance-none')}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} className="bg-[#0d0d10]">{c}</option>
                ))}
              </select>
            </div>
            <div className="relative">
              <label htmlFor="ev-city" className={MICRO_LABEL}>
                City <span aria-hidden="true" className="text-warm">*</span>
              </label>
              <input
                id="ev-city"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={city}
                onChange={(e) => {
                  setCity(e.target.value)
                  if (cityChosen) setCityChosen(false)
                }}
                onFocus={() => setCityFocused(true)}
                onBlur={() => setCityFocused(false)}
                placeholder="Start typing your city…"
                aria-expanded={showCityDropdown}
                aria-autocomplete="list"
                className={cn(FIELD, 'mt-2', cityChosen && 'border-moss/50')}
              />
              {cityChosen ? (
                <span aria-hidden="true" className="pointer-events-none absolute right-3 top-[2.55rem] text-moss">✓</span>
              ) : null}
              {showCityDropdown ? (
                <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-white/14 bg-[#0d0d10]/97 shadow-[0_24px_64px_rgba(0,0,0,0.55)]">
                  {citySearching && citySuggestions.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-white/55">Searching…</p>
                  ) : (
                    <ul>
                      {citySuggestions.map((hit) => (
                        <li key={hit.label}>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              selectCity(hit)
                            }}
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/8 focus-ring"
                          >
                            <span aria-hidden="true" className="text-warm">◎</span>
                            <span className="truncate">{hit.label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
              {!cityChosen && !geocodeDown && !citySearching && city.trim().length >= 2 &&
                citySuggestions.length === 0 && cityFocused ? (
                <p className="mt-1 text-xs text-white/45">Pick your city from the list.</p>
              ) : null}
            </div>
          </div>

          <div>
            <label htmlFor="ev-venue" className={MICRO_LABEL}>Venue (optional)</label>
            <input
              id="ev-venue"
              type="text"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="e.g. Skylight Rooftop"
              className={cn(FIELD, 'mt-2')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ev-date" className={MICRO_LABEL}>
                Date <span aria-hidden="true" className="text-warm">*</span>
              </label>
              <input
                id="ev-date"
                type="date"
                value={date}
                min={todayStr}
                onChange={(e) => setDate(e.target.value)}
                className={cn(FIELD, 'mt-2 [color-scheme:dark]')}
              />
            </div>
            <div>
              <label htmlFor="ev-time" className={MICRO_LABEL}>Start time</label>
              <input
                id="ev-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={cn(FIELD, 'mt-2 [color-scheme:dark]')}
              />
            </div>
          </div>

          <div>
            <span className={MICRO_LABEL}>Setting</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(['indoor', 'outdoor', 'mixed'] as InOut[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setInout(v)}
                  className={cn(
                    'min-h-11 rounded-2xl border px-3 text-sm font-semibold capitalize transition focus-ring',
                    inout === v
                      ? 'border-warm bg-warm/15 text-white'
                      : 'border-white/14 bg-black/30 text-white/70 hover:bg-white/8',
                  )}
                  aria-pressed={inout === v}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ev-capacity" className={MICRO_LABEL}>
                Capacity <span aria-hidden="true" className="text-warm">*</span>
              </label>
              <input
                id="ev-capacity"
                type="number"
                inputMode="numeric"
                min={1}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="e.g. 400"
                className={cn(FIELD, 'mt-2')}
              />
            </div>
            <div>
              <span className={MICRO_LABEL}>Ticket price</span>
              <div className="mt-2 flex gap-2">
                <select
                  aria-label="Currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className={cn(FIELD, 'w-24 shrink-0 appearance-none px-3')}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c} className="bg-[#0d0d10]">{c}</option>
                  ))}
                </select>
                <input
                  aria-label="Ticket price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={isFree ? '' : price}
                  disabled={isFree}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="25"
                  className={cn(FIELD, 'flex-1', isFree && 'opacity-40')}
                />
                <button
                  type="button"
                  onClick={() => setIsFree((f) => !f)}
                  className={cn(
                    'min-h-12 shrink-0 rounded-2xl border px-3 text-sm font-semibold transition focus-ring',
                    isFree
                      ? 'border-warm bg-warm/15 text-white'
                      : 'border-white/14 bg-black/30 text-white/70 hover:bg-white/8',
                  )}
                  aria-pressed={isFree}
                >
                  Free
                </button>
              </div>
            </div>
          </div>

          {/* Budget — only for FREE events. For paid events we RECOMMEND the
              profit-max budget (no need to ask). */}
          {isFree ? (
            <div className="rounded-2xl border border-warm/25 bg-warm/[0.06] p-4">
              <label htmlFor="ev-budget" className={MICRO_LABEL}>
                Promo budget <span className="text-white/40">(what you can spend to drive attendance)</span>
              </label>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm font-semibold text-white/60">{currency}</span>
                <input
                  id="ev-budget"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="e.g. 400"
                  className={cn(FIELD, 'flex-1')}
                />
              </div>
              <p className="mt-2 text-xs text-white/45">
                Free events earn no ticket revenue, so tell us your spend and we’ll show what it
                buys — attendees and cost per head. Leave blank for organic-only.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm text-white/70">
                <span className="font-semibold text-warm">No budget needed.</span> For a paid
                event we’ll <span className="font-semibold text-white">recommend the ad budget
                that makes you the most profit</span> — and show the math.
              </p>
            </div>
          )}

          <details className="group">
            <summary className="cursor-pointer list-none text-sm font-semibold text-warm underline-offset-4 hover:underline focus-ring">
              + Add lineup &amp; audience size (sharpens the forecast)
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="ev-lineup" className={MICRO_LABEL}>Lineup / host</label>
                <input
                  id="ev-lineup"
                  type="text"
                  value={lineup}
                  onChange={(e) => setLineup(e.target.value)}
                  placeholder="e.g. DJ Spinall + guests"
                  className={cn(FIELD, 'mt-2')}
                />
              </div>
              <div>
                <label htmlFor="ev-audience" className={MICRO_LABEL}>Your audience size</label>
                <input
                  id="ev-audience"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder="IG followers / email list"
                  className={cn(FIELD, 'mt-2')}
                />
              </div>
            </div>
          </details>

          <button
            type="button"
            onClick={handleRun}
            disabled={!canRun}
            className={buttonClasses({ variant: 'primary', size: 'lg', className: 'w-full sm:w-auto' })}
          >
            Forecast my turnout
          </button>
          {!canRun && missing.length > 0 ? (
            <p className="mt-3 text-sm text-white/55">
              Still need:{' '}
              <span className="font-semibold text-warm">{missing.join(' · ')}</span>
            </p>
          ) : null}
        </div>

        <p className="mt-4 text-xs text-white/45">
          Free while in test. No account needed — we research your event live and email
          your full report.
        </p>
      </div>
    </div>
  )
}
