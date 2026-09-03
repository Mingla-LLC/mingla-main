'use client'
// #1005 [Quote Any Trip] — the client state machine: intake → running → report.
//
// INTAKE — a pure, validated trip form (destination autocomplete, no DB match; a
// fresh trip isn't in any catalogue). RUNNING — progress theater while the run
// does live cost research + the pricing engine + synthesis (~20-30s). REPORT —
// the parchment document (TripReportView), gated behind an emailed link.

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { buttonClasses } from '@/components/ui/button'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { detectClientPlatform } from '@/lib/device-platform'
import { BUSINESS_ONELINK_URL, BUSINESS_WEB_URL } from '@/lib/store-links'
import {
  runTripQuoter,
  searchCities,
  type CitySuggestion,
  type GrowthToolsError,
  type TripReport,
  type TripRunInput,
  type TripVibe,
} from '@/lib/growth-tools-submit'
import { TripReportView } from './TripReportView'

type Phase = 'intake' | 'running' | 'report'

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

const CURRENCIES = ['USD', 'GBP', 'EUR', 'NGN', 'CAD', 'AUD', 'AED', 'ZAR', 'INR', 'NZD']

const VIBES: { value: TripVibe; label: string; sub: string }[] = [
  { value: 'budget', label: 'Budget', sub: 'Value-first' },
  { value: 'balanced', label: 'Balanced', sub: 'Comfortable' },
  { value: 'luxury', label: 'Luxury', sub: 'Premium' },
]

const INCLUDE_ITEMS: { key: 'stay' | 'activities' | 'meals' | 'transport'; label: string }[] = [
  { key: 'stay', label: 'Stay' },
  { key: 'activities', label: 'Activities' },
  { key: 'meals', label: 'Food & drink' },
  { key: 'transport', label: 'Local transport' },
]

const THEATER_LINES = [
  'Pricing real hotels for your dates',
  'Finding activities worth building around',
  'Checking what comparable trips charge',
  'Reading demand for your destination',
  'Building your line-item cost sheet',
  'Writing your client-ready quote',
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

  // Device-aware "publish your trip" target — desktop → business web, mobile → app.
  const [appHref, setAppHref] = useState(BUSINESS_WEB_URL)
  useEffect(() => {
    const p = detectClientPlatform()
    if (p === 'ios' || p === 'android') {
      setAppHref(`${BUSINESS_ONELINK_URL}?pid=tool_trips&c=tool_trips`)
    }
  }, [])

  if (error) {
    const rateLimited = error === 'rate_limited'
    return (
      <div className="rounded-md glass-soft p-6 md:p-8" role="alert">
        <p className="font-display text-2xl text-white">
          {rateLimited ? 'You’ve used your free quotes for today' : 'That didn’t work — try again'}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-white/70 md:text-base">
          {rateLimited
            ? 'That’s your free quotes used up for today — come back tomorrow, or publish your trip on the Mingla app now to give clients a real place to book.'
            : 'Something broke while building your quote. Give it another go — it usually works the second time.'}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {rateLimited ? (
            <a
              href={appHref}
              onClick={() => captureMarketing('tool_ratelimit_cta_click', { tool: 'trips' })}
              className={buttonClasses({ variant: 'primary' })}
            >
              Publish your trip on Mingla
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
        Quoting <span className="break-words text-warm">{title}</span>…
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
        This takes 20–30 seconds — we price real hotels, activities and the market live.
      </p>
    </div>
  )
}

export function TripQuoterExperience({ embedded = false }: { readonly embedded?: boolean } = {}) {
  const [phase, setPhase] = useState<Phase>('intake')

  const [title, setTitle] = useState('')
  const [destination, setDestination] = useState('')
  const [destSuggestions, setDestSuggestions] = useState<CitySuggestion[]>([])
  const [destSearching, setDestSearching] = useState(false)
  const [destFocused, setDestFocused] = useState(false)
  const [destChosen, setDestChosen] = useState(false)
  const [geocodeDown, setGeocodeDown] = useState(false)
  const destAbort = useRef<AbortController | null>(null)

  const [departure, setDeparture] = useState('')
  const [startDate, setStartDate] = useState('')
  const [nights, setNights] = useState('')
  const [groupSize, setGroupSize] = useState('')
  const [vibe, setVibe] = useState<TripVibe>('balanced')
  const [vibeNote, setVibeNote] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [includes, setIncludes] = useState({ stay: true, activities: true, meals: true, transport: true })

  const [runError, setRunError] = useState<GrowthToolsError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [runId, setRunId] = useState<string | null>(null)
  const [report, setReport] = useState<TripReport | null>(null)

  // Debounced destination autocomplete (validates against Mapbox). Skips while a
  // suggestion is chosen; degrades to free text if the geocoder is down.
  useEffect(() => {
    const q = destination.trim()
    if (destChosen || q.length < 2) {
      setDestSuggestions([])
      setDestSearching(false)
      return
    }
    setDestSearching(true)
    const timer = setTimeout(async () => {
      destAbort.current?.abort()
      const controller = new AbortController()
      destAbort.current = controller
      try {
        const res = await searchCities(q, controller.signal)
        if (controller.signal.aborted) return
        setDestSearching(false)
        if (res.ok) {
          setDestSuggestions(res.cities)
          setGeocodeDown(false)
        } else {
          setDestSuggestions([])
          if (res.error === 'network' || res.error === 'server') setGeocodeDown(true)
        }
      } catch {
        // superseded by a newer keystroke
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [destination, destChosen])

  function selectDest(hit: CitySuggestion) {
    const value = hit.country
      ? `${hit.city}, ${hit.country}`
      : hit.region
        ? `${hit.city}, ${hit.region}`
        : hit.city
    setDestination(value)
    setDestChosen(true)
    setDestSuggestions([])
    setDestSearching(false)
  }

  // LOCAL today (not UTC) — toISOString() is UTC and rolls a day early for anyone
  // ahead of UTC, silently failing "date >= today" on valid same-day trips.
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(startDate) && startDate >= todayStr
  const nightsNum = Number(nights)
  const nightsValid = Number.isFinite(nightsNum) && nightsNum >= 1
  const groupNum = Number(groupSize)
  const groupValid = Number.isFinite(groupNum) && groupNum >= 1
  // The autocomplete validates the destination, but a typed one is accepted too.
  const destValid = destChosen || destination.trim().length >= 2
  const showDestDropdown =
    destFocused && !destChosen && destination.trim().length >= 2 &&
    (destSearching || destSuggestions.length > 0)

  const missing: string[] = []
  if (title.trim().length < 2) missing.push('trip name')
  if (!destValid) missing.push('destination')
  if (!dateValid) missing.push('a start date (today or later)')
  if (!nightsValid) missing.push('number of nights')
  if (!groupValid) missing.push('group size')
  const canRun = missing.length === 0

  async function handleRun() {
    if (!canRun) return
    captureMarketing('tool_run_started', { tool: 'trips' })
    setRunError(null)
    setAttempt((n) => n + 1)
    setPhase('running')
    const input: TripRunInput = {
      title: title.trim(),
      destination: destination.trim(),
      departure: departure.trim(),
      start_date: startDate,
      nights: Math.round(nightsNum),
      group_size: Math.round(groupNum),
      vibe,
      vibe_note: vibeNote.trim() || null,
      includes,
      currency,
    }
    const res = await runTripQuoter(input, { pid: 'tool_trips', utm: collectUtm() })
    if (res.ok) {
      setRunId(res.run_id)
      setReport(res.report)
      captureMarketing('tool_report_ready', { tool: 'trips', run_id: res.run_id })
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
            ← Quote another trip
          </button>
          <TripReportView report={report} runId={runId} />
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
            title={title.trim() || 'your trip'}
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
          Quote Any Trip
        </span>
        {embedded ? (
          <h3 className="mt-4 font-display text-4xl leading-[1.08] tracking-[-0.02em] text-white md:text-5xl">Price any trip in a minute, not a spreadsheet.</h3>
        ) : (
          <h1 className="mt-4 font-display text-4xl leading-[1.08] tracking-[-0.02em] text-white md:text-5xl">Price any trip in a minute, not a spreadsheet.</h1>
        )}
        <p className="mt-4 max-w-xl text-base leading-relaxed text-white/72 md:text-lg">
          Describe the trip and we build the whole costed plan — real hotels and activities with
          current prices, a line-item cost sheet, and exactly what to charge per person. Free.
        </p>

        <div className="mt-10 space-y-5 rounded-md glass-soft p-5 sm:p-6 md:p-8">
          <div>
            <label htmlFor="tp-title" className={MICRO_LABEL}>
              Trip name <span aria-hidden="true" className="text-warm">*</span>
            </label>
            <input
              id="tp-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Marrakech Long Weekend for 10"
              className={cn(FIELD, 'mt-2')}
            />
          </div>

          <div className="relative">
            <label htmlFor="tp-dest" className={MICRO_LABEL}>
              Destination <span aria-hidden="true" className="text-warm">*</span>
            </label>
            <input
              id="tp-dest"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value)
                if (destChosen) setDestChosen(false)
              }}
              onFocus={() => setDestFocused(true)}
              onBlur={() => setDestFocused(false)}
              placeholder="Start typing a city or country…"
              aria-expanded={showDestDropdown}
              aria-autocomplete="list"
              className={cn(FIELD, 'mt-2', destChosen && 'border-moss/50')}
            />
            {destChosen ? (
              <span aria-hidden="true" className="pointer-events-none absolute right-3 top-[2.55rem] text-moss">✓</span>
            ) : null}
            {showDestDropdown ? (
              <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-white/14 bg-[#0d0d10]/97 shadow-[0_24px_64px_rgba(0,0,0,0.55)]">
                {destSearching && destSuggestions.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-white/55">Searching…</p>
                ) : (
                  <ul>
                    {destSuggestions.map((hit) => (
                      <li key={hit.label}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            selectDest(hit)
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
            {!destChosen && !geocodeDown && !destSearching && destination.trim().length >= 2 &&
              destSuggestions.length === 0 && destFocused ? (
              <p className="mt-1 text-xs text-white/45">Pick your destination from the list.</p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
            <div>
              <label htmlFor="tp-date" className={MICRO_LABEL}>
                Start date <span aria-hidden="true" className="text-warm">*</span>
              </label>
              <input
                id="tp-date"
                type="date"
                value={startDate}
                min={todayStr}
                onChange={(e) => setStartDate(e.target.value)}
                className={cn(FIELD, 'mt-2 [color-scheme:dark]')}
              />
            </div>
            <div>
              <label htmlFor="tp-nights" className={MICRO_LABEL}>
                Nights <span aria-hidden="true" className="text-warm">*</span>
              </label>
              <input
                id="tp-nights"
                type="number"
                inputMode="numeric"
                min={1}
                value={nights}
                onChange={(e) => setNights(e.target.value)}
                placeholder="4"
                className={cn(FIELD, 'mt-2 sm:w-24')}
              />
            </div>
            <div>
              <label htmlFor="tp-group" className={MICRO_LABEL}>
                People <span aria-hidden="true" className="text-warm">*</span>
              </label>
              <input
                id="tp-group"
                type="number"
                inputMode="numeric"
                min={1}
                value={groupSize}
                onChange={(e) => setGroupSize(e.target.value)}
                placeholder="10"
                className={cn(FIELD, 'mt-2 sm:w-24')}
              />
            </div>
          </div>

          <div>
            <span className={MICRO_LABEL}>Style</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {VIBES.map((v) => (
                <button
                  key={v.value}
                  type="button"
                  onClick={() => setVibe(v.value)}
                  className={cn(
                    'min-h-14 rounded-2xl border px-3 text-center transition focus-ring',
                    vibe === v.value
                      ? 'border-warm bg-warm/15 text-white'
                      : 'border-white/14 bg-black/30 text-white/70 hover:bg-white/8',
                  )}
                  aria-pressed={vibe === v.value}
                >
                  <span className="block text-sm font-semibold">{v.label}</span>
                  <span className="block text-[0.7rem] text-white/50">{v.sub}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className={MICRO_LABEL}>Currency</span>
            <select
              aria-label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={cn(FIELD, 'mt-2 appearance-none')}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c} className="bg-[#0d0d10]">{c}</option>
              ))}
            </select>
          </div>

          <details className="group">
            <summary className="cursor-pointer list-none text-sm font-semibold text-warm underline-offset-4 hover:underline focus-ring">
              + Departure city, style notes &amp; what’s included (sharpens the quote)
            </summary>
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="tp-departure" className={MICRO_LABEL}>Departing from</label>
                  <input
                    id="tp-departure"
                    type="text"
                    value={departure}
                    onChange={(e) => setDeparture(e.target.value)}
                    placeholder="e.g. London"
                    className={cn(FIELD, 'mt-2')}
                  />
                </div>
                <div>
                  <label htmlFor="tp-note" className={MICRO_LABEL}>Style notes</label>
                  <input
                    id="tp-note"
                    type="text"
                    value={vibeNote}
                    onChange={(e) => setVibeNote(e.target.value)}
                    placeholder="e.g. foodie, no early starts"
                    className={cn(FIELD, 'mt-2')}
                  />
                </div>
              </div>
              <div>
                <span className={MICRO_LABEL}>What the price should include</span>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {INCLUDE_ITEMS.map((item) => {
                    const on = includes[item.key]
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setIncludes((s) => ({ ...s, [item.key]: !s[item.key] }))}
                        className={cn(
                          'min-h-11 rounded-2xl border px-3 text-sm font-semibold transition focus-ring',
                          on
                            ? 'border-warm bg-warm/15 text-white'
                            : 'border-white/14 bg-black/30 text-white/45 hover:bg-white/8',
                        )}
                        aria-pressed={on}
                      >
                        {on ? '✓ ' : ''}{item.label}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-2 text-xs text-white/45">
                  Flights are never included — we price the on-the-ground trip.
                </p>
              </div>
            </div>
          </details>

          <button
            type="button"
            onClick={handleRun}
            disabled={!canRun}
            className={buttonClasses({ variant: 'primary', size: 'lg', className: 'w-full sm:w-auto' })}
          >
            Quote this trip
          </button>
          {!canRun && missing.length > 0 ? (
            <p className="mt-3 text-sm text-white/55">
              Still need:{' '}
              <span className="font-semibold text-warm">{missing.join(' · ')}</span>
            </p>
          ) : null}
        </div>

        <p className="mt-4 text-xs text-white/45">
          Free while in test. No account needed — we research your trip live and email your
          full costed proposal. Prices are current estimates, not guaranteed rates.
        </p>
      </div>
    </div>
  )
}
