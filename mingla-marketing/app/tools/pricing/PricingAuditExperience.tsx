'use client'
// #1006 [The Undercharging Audit] — the client state machine: intake → running →
// report.
//
// INTAKE — a validated experience form (description, city autocomplete, seats,
// current price, cadence + optional costs). RUNNING — progress theater while the
// run does live comp research + the audit engine + synthesis (~15-25s). REPORT —
// the parchment audit document (PricingReportView), gated behind an emailed link.

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { buttonClasses } from '@/components/ui/button'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { detectClientPlatform } from '@/lib/device-platform'
import { BUSINESS_ONELINK_URL, BUSINESS_WEB_URL } from '@/lib/store-links'
import {
  runPricingAudit,
  searchCities,
  type CitySuggestion,
  type GrowthToolsError,
  type PricingReport,
  type PricingRunInput,
} from '@/lib/growth-tools-submit'
import { PricingReportView } from './PricingReportView'

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

const CATEGORIES = [
  'Workshop / class',
  'Supper club / dinner',
  'Tasting (wine / food)',
  'Tour / walk',
  'Fitness / run club',
  'Wellness / yoga',
  'Art / craft',
  'Music / performance',
  'Retreat',
  'Other',
]
const CURRENCIES = ['USD', 'GBP', 'EUR', 'NGN', 'CAD', 'AUD', 'AED', 'ZAR', 'INR', 'NZD']

const THEATER_LINES = [
  'Finding what similar experiences charge nearby',
  'Pricing your time at a fair local rate',
  'Working out your true cost per head',
  'Checking demand for your kind of experience',
  'Writing your pricing verdict',
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
      revealed === 0 ? 400 : 3000,
    )
    return () => clearTimeout(timer)
  }, [revealed, error])

  const [appHref, setAppHref] = useState(BUSINESS_WEB_URL)
  useEffect(() => {
    const p = detectClientPlatform()
    if (p === 'ios' || p === 'android') {
      setAppHref(`${BUSINESS_ONELINK_URL}?pid=tool_pricing&c=tool_pricing`)
    }
  }, [])

  if (error) {
    const rateLimited = error === 'rate_limited'
    return (
      <div className="rounded-md glass-soft p-6 md:p-8" role="alert">
        <p className="font-display text-2xl text-white">
          {rateLimited ? 'You’ve used your free audits for today' : 'That didn’t work — try again'}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-white/70 md:text-base">
          {rateLimited
            ? 'That’s your free audits used up for today — come back tomorrow, or relaunch your experience at the right price on the Mingla app now, with all-in checkout.'
            : 'Something broke while building your audit. Give it another go — it usually works the second time.'}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {rateLimited ? (
            <a
              href={appHref}
              onClick={() => captureMarketing('tool_ratelimit_cta_click', { tool: 'experiences' })}
              className={buttonClasses({ variant: 'primary' })}
            >
              Relaunch on Mingla
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
        Auditing <span className="break-words text-warm">{title}</span>…
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
        This takes 15–25 seconds — we research real comparable prices in your city.
      </p>
    </div>
  )
}

export function PricingAuditExperience({ embedded = false }: { readonly embedded?: boolean } = {}) {
  const [phase, setPhase] = useState<Phase>('intake')

  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [city, setCity] = useState('')
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([])
  const [citySearching, setCitySearching] = useState(false)
  const [cityFocused, setCityFocused] = useState(false)
  const [cityChosen, setCityChosen] = useState(false)
  const [geocodeDown, setGeocodeDown] = useState(false)
  const cityAbort = useRef<AbortController | null>(null)

  const [seats, setSeats] = useState('')
  const [price, setPrice] = useState('')
  const [isFree, setIsFree] = useState(false)
  const [currency, setCurrency] = useState('USD')
  const [perMonth, setPerMonth] = useState('')
  const [venueCost, setVenueCost] = useState('')
  const [materialsCost, setMaterialsCost] = useState('')
  const [ownHours, setOwnHours] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')

  const [runError, setRunError] = useState<GrowthToolsError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [runId, setRunId] = useState<string | null>(null)
  const [report, setReport] = useState<PricingReport | null>(null)

  // Debounced city autocomplete (validates the city against Mapbox).
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
        // superseded
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

  const seatsNum = Number(seats)
  const seatsValid = Number.isFinite(seatsNum) && seatsNum >= 1
  const priceNum = Number(price)
  // A currently-FREE experience (0) is valid — it's the ultimate under-charger.
  const priceValid = isFree || (price.trim() !== '' && Number.isFinite(priceNum) && priceNum >= 0)
  const perMonthNum = Number(perMonth)
  const perMonthValid = Number.isFinite(perMonthNum) && perMonthNum >= 1
  const cityValid = cityChosen || city.trim().length >= 2
  const showCityDropdown =
    cityFocused && !cityChosen && city.trim().length >= 2 &&
    (citySearching || citySuggestions.length > 0)

  const missing: string[] = []
  if (description.trim().length < 4) missing.push('what your experience is')
  if (!cityValid) missing.push('city')
  if (!seatsValid) missing.push('seats per event')
  if (!priceValid) missing.push('your current price (or mark it free)')
  if (!perMonthValid) missing.push('how often you run it')
  const canRun = missing.length === 0

  function optNum(v: string): number | null {
    const n = Number(v)
    return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null
  }

  async function handleRun() {
    if (!canRun) return
    captureMarketing('tool_run_started', { tool: 'experiences' })
    setRunError(null)
    setAttempt((n) => n + 1)
    setPhase('running')
    const input: PricingRunInput = {
      description: description.trim(),
      category: category.trim(),
      city: city.trim(),
      seats: Math.round(seatsNum),
      current_price: isFree ? 0 : Math.max(0, priceNum),
      events_per_month: Math.round(perMonthNum),
      currency,
      venue_cost: optNum(venueCost),
      materials_cost: optNum(materialsCost),
      own_hours: optNum(ownHours),
      hourly_rate: optNum(hourlyRate),
    }
    const res = await runPricingAudit(input, { pid: 'tool_pricing', utm: collectUtm() })
    if (res.ok) {
      setRunId(res.run_id)
      setReport(res.report)
      captureMarketing('tool_report_ready', { tool: 'experiences', run_id: res.run_id })
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
            ← Audit another experience
          </button>
          <PricingReportView report={report} runId={runId} />
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
            title={description.trim().slice(0, 40) || 'your experience'}
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
          The Undercharging Audit
        </span>
        {embedded ? (
          <h3 className="mt-4 font-display text-4xl leading-[1.08] tracking-[-0.02em] text-white md:text-5xl">Are you charging what you’re worth?</h3>
        ) : (
          <h1 className="mt-4 font-display text-4xl leading-[1.08] tracking-[-0.02em] text-white md:text-5xl">Are you charging what you’re worth?</h1>
        )}
        <p className="mt-4 max-w-xl text-base leading-relaxed text-white/72 md:text-lg">
          Most hosts price by guilt and quietly lose money — because their own time was never in
          the number. Get a free audit: your true cost per head, what comparable experiences
          charge, and the price you should be charging.
        </p>

        <div className="mt-10 space-y-5 rounded-md glass-soft p-5 sm:p-6 md:p-8">
          <div>
            <label htmlFor="pr-desc" className={MICRO_LABEL}>
              What’s your experience? <span aria-hidden="true" className="text-warm">*</span>
            </label>
            <textarea
              id="pr-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="e.g. A hands-on pasta-making supper club with wine pairing"
              className={cn(FIELD, 'mt-2 py-3 leading-relaxed')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pr-category" className={MICRO_LABEL}>
                Type <span aria-hidden="true" className="text-warm">*</span>
              </label>
              <select
                id="pr-category"
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
              <label htmlFor="pr-city" className={MICRO_LABEL}>
                City <span aria-hidden="true" className="text-warm">*</span>
              </label>
              <input
                id="pr-city"
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

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="pr-seats" className={MICRO_LABEL}>
                Seats / event <span aria-hidden="true" className="text-warm">*</span>
              </label>
              <input
                id="pr-seats"
                type="number"
                inputMode="numeric"
                min={1}
                value={seats}
                onChange={(e) => setSeats(e.target.value)}
                placeholder="12"
                className={cn(FIELD, 'mt-2')}
              />
            </div>
            <div>
              <span className={MICRO_LABEL}>
                Current price <span aria-hidden="true" className="text-warm">*</span>
              </span>
              <div className="mt-2 flex gap-2">
                <select
                  aria-label="Currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  disabled={isFree}
                  className={cn(FIELD, 'w-[4.5rem] shrink-0 appearance-none px-2', isFree && 'opacity-40')}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c} className="bg-[#0d0d10]">{c}</option>
                  ))}
                </select>
                <input
                  aria-label="Current price per person"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={isFree ? '' : price}
                  disabled={isFree}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder={isFree ? 'Free' : '45'}
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
              {isFree ? (
                <p className="mt-1 text-xs text-white/45">
                  Free right now? We&rsquo;ll show what your time is worth and what to start charging.
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor="pr-permonth" className={MICRO_LABEL}>
                Times / month <span aria-hidden="true" className="text-warm">*</span>
              </label>
              <input
                id="pr-permonth"
                type="number"
                inputMode="numeric"
                min={1}
                value={perMonth}
                onChange={(e) => setPerMonth(e.target.value)}
                placeholder="4"
                className={cn(FIELD, 'mt-2')}
              />
            </div>
          </div>

          <details className="group">
            <summary className="cursor-pointer list-none text-sm font-semibold text-warm underline-offset-4 hover:underline focus-ring">
              + Your costs &amp; time (makes the loss number real, not estimated)
            </summary>
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="pr-venue" className={MICRO_LABEL}>Venue / space cost (per event)</label>
                  <input
                    id="pr-venue"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={venueCost}
                    onChange={(e) => setVenueCost(e.target.value)}
                    placeholder="e.g. 150 (blank = your own space)"
                    className={cn(FIELD, 'mt-2')}
                  />
                </div>
                <div>
                  <label htmlFor="pr-materials" className={MICRO_LABEL}>Materials / supplies (per event)</label>
                  <input
                    id="pr-materials"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={materialsCost}
                    onChange={(e) => setMaterialsCost(e.target.value)}
                    placeholder="e.g. 120"
                    className={cn(FIELD, 'mt-2')}
                  />
                </div>
                <div>
                  <label htmlFor="pr-hours" className={MICRO_LABEL}>Your hours (per event)</label>
                  <input
                    id="pr-hours"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={ownHours}
                    onChange={(e) => setOwnHours(e.target.value)}
                    placeholder="prep + delivery, e.g. 8"
                    className={cn(FIELD, 'mt-2')}
                  />
                </div>
                <div>
                  <label htmlFor="pr-rate" className={MICRO_LABEL}>Your time is worth ({currency}/hr)</label>
                  <input
                    id="pr-rate"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(e.target.value)}
                    placeholder="blank = we set a fair rate"
                    className={cn(FIELD, 'mt-2')}
                  />
                </div>
              </div>
              <p className="text-xs text-white/45">
                Leave any blank and we’ll estimate it from live research — and label it as estimated
                in your audit.
              </p>
            </div>
          </details>

          <button
            type="button"
            onClick={handleRun}
            disabled={!canRun}
            className={buttonClasses({ variant: 'primary', size: 'lg', className: 'w-full sm:w-auto' })}
          >
            Audit my pricing
          </button>
          {!canRun && missing.length > 0 ? (
            <p className="mt-3 text-sm text-white/55">
              Still need:{' '}
              <span className="font-semibold text-warm">{missing.join(' · ')}</span>
            </p>
          ) : null}
        </div>

        <p className="mt-4 text-xs text-white/45">
          Free while in test. No account needed — we research real comparable prices and email
          your full audit. Comps are current estimates; your loss/upside is your own maths, shown.
        </p>
      </div>
    </div>
  )
}
