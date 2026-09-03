'use client'
// #1003 [Venue Website Grader — growth tools, test cut] — the client state
// machine: intake → running → report.
//
// INTAKE — one "YOUR PLACE" field with a debounced (350ms, ≥2 chars) typeahead
// against growth-tools-run {action:'search'}; a selection shows an editable
// summary chip + the always-required Website field; a manual path reveals
// City + Website. RUNNING — progress theater (staged status lines on a timer,
// never a bare spinner) while the run request is in flight. REPORT — the
// parchment document (ReportView).

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { buttonClasses } from '@/components/ui/button'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import {
  runVenueGrader,
  searchGrowthToolsPlaces,
  type GraderReport,
  type GrowthToolsError,
  type GrowthToolsSearchResult,
} from '@/lib/growth-tools-submit'
import { ReportView } from './ReportView'

type Phase = 'intake' | 'running' | 'report'
/** search = typing/typeahead; selected = a search result chip; manual = typed-in place. */
type IntakeMode = 'search' | 'selected' | 'manual'

/** URL-ish check: add https:// when missing; require a dotted hostname. */
function normalizeWebsite(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if (!url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}

/** Display host ("yoursite.com") for theater lines + chips. */
function hostOf(website: string): string {
  const normalized = normalizeWebsite(website)
  if (!normalized) return website.trim()
  try {
    return new URL(normalized).hostname.replace(/^www\./, '')
  } catch {
    return website.trim()
  }
}

/** utm_* params from the current URL, forwarded to the run for attribution. */
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
const FIELD_INPUT =
  'min-h-12 w-full rounded-2xl border border-white/14 bg-black/30 px-4 text-base text-white placeholder:text-white/35 focus-ring'

// ─── Progress theater ───────────────────────────────────────────────────────

const THEATER_LINES = [
  'Taking a look at your site',
  'Running 11 automated site-health checks',
  'Reading your menu like a first-timer',
  'Checking how you look on a Friday night',
  'Ranking you against every venue in your city',
  'Sizing up your competition',
  'Building your head-to-head scorecard',
  'Writing your fixes',
] as const

function RunningTheater({
  host,
  error,
  onRetry,
  onBack,
}: {
  host: string
  error: GrowthToolsError | null
  onRetry: () => void
  onBack: () => void
}) {
  // Number of lines revealed. The last revealed line stays "active" (pulsing);
  // everything before it gets a ✓. Timer-driven so it never sits on a bare spinner.
  const [revealed, setRevealed] = useState(0)
  useEffect(() => {
    if (error) return
    if (revealed >= THEATER_LINES.length) return
    const timer = setTimeout(
      () => setRevealed((count) => Math.min(count + 1, THEATER_LINES.length)),
      revealed === 0 ? 400 : 2400,
    )
    return () => clearTimeout(timer)
  }, [revealed, error])

  if (error) {
    const rateLimited = error === 'rate_limited'
    return (
      <div className="rounded-md glass-soft p-6 md:p-8" role="alert">
        <p className="font-display text-2xl text-white">
          {rateLimited ? 'You’ve hit today’s limit' : 'That didn’t work — try again'}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-white/70 md:text-base">
          {rateLimited
            ? 'The free grader is capped per day while it’s in test. Come back tomorrow — your report will be here.'
            : 'Something broke on our side while grading your site. Give it another go — it usually works the second time.'}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {!rateLimited ? (
            <button type="button" onClick={onRetry} className={buttonClasses({ variant: 'primary' })}>
              Try again
            </button>
          ) : null}
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
        Reading <span className="break-words text-warm">{host}</span>…
      </p>
      <ul className="mt-6 space-y-3" aria-live="polite">
        {THEATER_LINES.slice(0, Math.max(revealed, 1)).map((line, i) => {
          const isActive = i === Math.max(revealed, 1) - 1
          return (
            <li key={line} className="flex items-center gap-3 text-sm text-white/80 md:text-base">
              {isActive ? (
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 animate-pulse rounded-full bg-warm"
                />
              ) : (
                <span aria-hidden="true" className="shrink-0 font-semibold text-warm">
                  ✓
                </span>
              )}
              <span className={cn(isActive ? 'text-white' : 'text-white/60')}>{line}…</span>
            </li>
          )
        })}
      </ul>
      <p className="mt-6 text-xs text-white/45">
        This takes about a minute — we read the site the way a first-timer would.
      </p>
    </div>
  )
}

// ─── The experience ─────────────────────────────────────────────────────────

export function GraderExperience({ embedded = false }: { readonly embedded?: boolean } = {}) {
  const [phase, setPhase] = useState<Phase>('intake')

  // Intake state.
  const [mode, setMode] = useState<IntakeMode>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GrowthToolsSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const [selected, setSelected] = useState<GrowthToolsSearchResult | null>(null)
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [website, setWebsite] = useState('')

  // Run state.
  const [runError, setRunError] = useState<GrowthToolsError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [runId, setRunId] = useState<string | null>(null)
  const [report, setReport] = useState<GraderReport | null>(null)

  const searchAbort = useRef<AbortController | null>(null)

  // Debounced typeahead — 350ms, ≥2 chars, only while in search mode.
  useEffect(() => {
    if (mode !== 'search') return
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(async () => {
      searchAbort.current?.abort()
      const controller = new AbortController()
      searchAbort.current = controller
      try {
        const res = await searchGrowthToolsPlaces(q, undefined, controller.signal)
        if (controller.signal.aborted) return
        setSearching(false)
        setResults(res.ok ? res.results : [])
      } catch {
        // Aborted by a newer keystroke — the newer request owns the state.
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [query, mode])

  const effectiveName = (mode === 'manual' ? query : name).trim()
  const effectiveCity = city.trim()
  const normalizedWebsite = normalizeWebsite(website)
  const websiteInvalid = website.trim().length > 0 && normalizedWebsite === null
  const canRun =
    (mode === 'selected' || mode === 'manual') &&
    effectiveName.length > 0 &&
    effectiveCity.length > 0 &&
    normalizedWebsite !== null

  function selectResult(result: GrowthToolsSearchResult) {
    setSelected(result)
    setMode('selected')
    setName(result.name)
    setCity(result.city ?? '')
    setWebsite(result.website ?? '')
    setQuery(result.name)
    setResults([])
    setSearching(false)
  }

  function handleQueryChange(value: string) {
    setQuery(value)
    if (mode === 'selected') {
      // Typing over a selection restarts the search.
      setSelected(null)
      setMode('search')
    }
  }

  function switchToManual() {
    // Keep whatever is already known; the main field becomes the name.
    if (mode === 'selected') setQuery(name)
    setSelected(null)
    setResults([])
    setSearching(false)
    setMode('manual')
  }

  async function handleRun() {
    if (!canRun || normalizedWebsite === null) return
    captureMarketing('tool_run_started', { tool: 'venues' })
    setRunError(null)
    setAttempt((n) => n + 1)
    setPhase('running')
    const res = await runVenueGrader(
      {
        name: effectiveName,
        city: effectiveCity,
        website: normalizedWebsite,
        ...(mode === 'selected' && selected ? { place_id: selected.id } : {}),
      },
      { pid: 'tool_venues', utm: collectUtm() },
    )
    if (res.ok) {
      setRunId(res.run_id)
      setReport(res.report)
      captureMarketing('tool_report_ready', { tool: 'venues', run_id: res.run_id })
      setPhase('report')
      return
    }
    setRunError(res.error)
  }

  function resetToIntake() {
    setRunError(null)
    setPhase('intake')
  }

  const showDropdown =
    mode === 'search' && inputFocused && query.trim().length >= 2 && (searching || results.length > 0)

  // ── REPORT ────────────────────────────────────────────────────────────────
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
            ← Grade another website
          </button>
          <ReportView report={report} runId={runId} />
        </div>
      </div>
    )
  }

  // ── RUNNING ───────────────────────────────────────────────────────────────
  if (phase === 'running') {
    return (
      <div className={embedded ? 'p-0' : 'px-6 py-16 md:px-10 md:py-24 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))]'}>
        <div className="mx-auto max-w-xl">
          <RunningTheater
            key={attempt}
            host={hostOf(website)}
            error={runError}
            onRetry={handleRun}
            onBack={resetToIntake}
          />
        </div>
      </div>
    )
  }

  // ── INTAKE ────────────────────────────────────────────────────────────────
  return (
    <div className={embedded ? 'p-0' : 'px-6 py-14 md:px-10 md:py-20 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))]'}>
      <div className="mx-auto max-w-2xl">
        <span className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm">
          Venue Website Grader
        </span>
        {embedded ? (
          <h3 className="mt-4 font-display text-4xl leading-[1.08] tracking-[-0.02em] text-white md:text-5xl">Your website is costing you customers.</h3>
        ) : (
          <h1 className="mt-4 font-display text-4xl leading-[1.08] tracking-[-0.02em] text-white md:text-5xl">Your website is costing you customers.</h1>
        )}
        <p className="mt-4 max-w-xl text-base leading-relaxed text-white/72 md:text-lg">
          See exactly how — free, in 60 seconds. For restaurants, bars, cafés,
          clubs and activity spaces.
        </p>

        <div className="mt-10 rounded-md glass-soft p-5 sm:p-6 md:p-8">
          {/* YOUR PLACE — search-first field */}
          <div className="relative">
            <label htmlFor="grader-place" className={MICRO_LABEL}>
              Your place <span aria-hidden="true" className="text-warm">*</span>
            </label>
            <input
              id="grader-place"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="Start typing your place's name…"
              aria-expanded={showDropdown}
              aria-autocomplete="list"
              className={cn(FIELD_INPUT, 'mt-2')}
            />

            {showDropdown ? (
              <div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-white/14 bg-[#0d0d10]/97 shadow-[0_24px_64px_rgba(0,0,0,0.55)]">
                {searching && results.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-white/55">Searching…</p>
                ) : (
                  <ul>
                    {results.map((result) => (
                      <li key={result.id}>
                        <button
                          type="button"
                          // onMouseDown so selection fires before the input blur.
                          onMouseDown={(e) => {
                            e.preventDefault()
                            selectResult(result)
                          }}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/8 focus-ring"
                        >
                          {result.photo_url ? (
                            <img
                              src={result.photo_url}
                              alt=""
                              className="size-10 shrink-0 rounded-sm object-cover"
                            />
                          ) : (
                            <span
                              aria-hidden="true"
                              className="grid size-10 shrink-0 place-items-center rounded-sm bg-warm/15 font-display text-sm text-warm"
                            >
                              {result.name.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-white">
                              {result.name}
                            </span>
                            <span className="block truncate text-xs text-white/55">
                              {[result.city, result.website ? hostOf(result.website) : null]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>

          {/* Selected summary chip — editable */}
          {mode === 'selected' && selected ? (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-warm/40 bg-warm/10 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{name}</p>
                <p className="mt-0.5 truncate text-xs text-white/60">
                  {[city, website ? hostOf(website) : 'no website on file']
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <button
                type="button"
                onClick={switchToManual}
                className="shrink-0 rounded-full border border-white/14 bg-white/8 px-3 py-1.5 text-xs font-semibold text-text-secondary transition hover:bg-white/12 hover:text-text-primary focus-ring"
              >
                Edit details
              </button>
            </div>
          ) : null}

          {/* Manual reveal — City + Website */}
          {mode === 'manual' ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="grader-city" className={MICRO_LABEL}>
                  City <span aria-hidden="true" className="text-warm">*</span>
                </label>
                <input
                  id="grader-city"
                  type="text"
                  autoComplete="address-level2"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. London"
                  className={cn(FIELD_INPUT, 'mt-2')}
                />
              </div>
              <div>
                <label htmlFor="grader-website-manual" className={MICRO_LABEL}>
                  Website <span aria-hidden="true" className="text-warm">*</span>
                </label>
                <input
                  id="grader-website-manual"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="yourplace.com"
                  aria-invalid={websiteInvalid}
                  className={cn(
                    FIELD_INPUT,
                    'mt-2',
                    websiteInvalid && 'border-red-400/60',
                  )}
                />
              </div>
            </div>
          ) : null}

          {/* Website — always required once a place is selected */}
          {mode === 'selected' ? (
            <div className="mt-4">
              <label htmlFor="grader-website" className={MICRO_LABEL}>
                Website <span aria-hidden="true" className="text-warm">*</span>
              </label>
              <input
                id="grader-website"
                type="url"
                inputMode="url"
                autoComplete="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="yourplace.com"
                aria-invalid={websiteInvalid}
                className={cn(FIELD_INPUT, 'mt-2', websiteInvalid && 'border-red-400/60')}
              />
            </div>
          ) : null}

          {websiteInvalid ? (
            <p className="mt-2 text-xs text-red-300">
              Enter a valid website — e.g. yourplace.com
            </p>
          ) : null}

          {/* Manual escape hatch (search mode only) */}
          {mode === 'search' ? (
            <button
              type="button"
              onClick={switchToManual}
              className="mt-4 rounded-sm text-sm font-semibold text-warm underline-offset-4 transition hover:underline focus-ring"
            >
              Can&rsquo;t find your place? Add it manually
            </button>
          ) : null}

          {mode === 'selected' || mode === 'manual' ? (
            <button
              type="button"
              onClick={handleRun}
              disabled={!canRun}
              className={buttonClasses({
                variant: 'primary',
                size: 'lg',
                className: 'mt-6 w-full sm:w-auto',
              })}
            >
              Run my free report
            </button>
          ) : null}
        </div>

        <p className="mt-4 text-xs text-white/45">
          Free while in test. No account needed — we grade the live site, nothing
          is installed or changed.
        </p>
      </div>
    </div>
  )
}
