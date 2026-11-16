'use client'
// #1003 [Venue Website Grader — growth tools, test cut] — the client state
// machine: intake → running → report.
//
// INTAKE — one "Your place" field with a debounced (350ms, ≥2 chars) Google
// place search against growth-tools-run {action:'search'}; a pick fills the
// name, city and website (shown as the place card); a manual path reveals City
// + Website. RUNNING — the research screen. REPORT — the gated preview (web
// lane) or the full report (app lane).
//
// #4452 §6.1–6.3: on the paper template (design ch. 4c). When the Google pick
// has no website, the grader asks "Where do people find you today?" (asked
// because Google lists no website) and runs without one; the report and fixes
// are then about getting a page.

import { useEffect, useRef, useState } from 'react'
import { PreviewGate } from '../_preview/PreviewGate'
import { Choice, FollowupBlock, ResearchScreen, RunError, StillNeed, ToolField, ToolPage } from '../_template/ToolPage'
import type { ToolPreview } from '@/lib/growth-tools-submit'
import { captureMarketing } from '@/components/marketing/marketing-capture'
import {
  runVenueGrader,
  searchGrowthToolsPlaces,
  type GraderReport,
  type GrowthToolsError,
  type GrowthToolsSearchResult,
} from '@/lib/growth-tools-submit'
import { followupActive, followupBody, followupMissing, SCENARIO, type FollowupAnswers } from '@/lib/tools/scenarios'
import { ReportView } from './ReportView'

type Phase = 'intake' | 'running' | 'report'
/** search = typing/typeahead; selected = a search result chip; manual = typed-in place. */
type IntakeMode = 'search' | 'selected' | 'manual'
type FoundVia = 'instagram' | 'whatsapp' | 'google_only'

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

/** Display host ("yoursite.com") for the place card. */
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

const FOUND_VIA: ReadonlyArray<{ value: FoundVia; label: string }> = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'google_only', label: 'Google only' },
]

export function GraderExperience({ embedded = false }: { readonly embedded?: boolean } = {}) {
  const [phase, setPhase] = useState<Phase>('intake')

  // Intake state.
  const [mode, setMode] = useState<IntakeMode>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GrowthToolsSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [active, setActive] = useState(0)
  const [selected, setSelected] = useState<GrowthToolsSearchResult | null>(null)
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [website, setWebsite] = useState('')
  const [editWebsite, setEditWebsite] = useState(false)
  const [foundVia, setFoundVia] = useState<FoundVia | null>(null)

  // Run state.
  const [runError, setRunError] = useState<GrowthToolsError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [runId, setRunId] = useState<string | null>(null)
  const [report, setReport] = useState<GraderReport | null>(null)
  const [preview, setPreview] = useState<ToolPreview | null>(null)
  const [ranNoSite, setRanNoSite] = useState(false)

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
        setActive(0)
      } catch {
        // Aborted by a newer keystroke — the newer request owns the state.
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [query, mode])

  // #4452 §6.2: the Google pick lists no website (and none was typed).
  const facts = { tool: 'venues' as const, googlePick: mode === 'selected' && selected !== null, googleWebsite: selected?.website ?? '', typedWebsite: website }
  const noSite = followupActive(facts)
  const answers: FollowupAnswers = { tool: 'venues', found_via: foundVia }
  const body = followupBody(facts, answers)
  const followup = body && 'found_via' in body ? body : null

  const effectiveName = (mode === 'manual' ? query : name).trim()
  const effectiveCity = city.trim()
  const normalizedWebsite = normalizeWebsite(website)
  const websiteInvalid = website.trim().length > 0 && normalizedWebsite === null
  const missing: string[] = []
  if (mode === 'search') missing.push('pick your place from Google')
  if (mode !== 'search' && effectiveName.length === 0) missing.push('the name')
  if (mode !== 'search' && effectiveCity.length === 0) missing.push('the city')
  if (mode !== 'search' && !noSite && normalizedWebsite === null) missing.push('your website')
  if (noSite) missing.push(...followupMissing(answers))
  const canRun = missing.length === 0

  function selectResult(result: GrowthToolsSearchResult) {
    setSelected(result)
    setMode('selected')
    setName(result.name)
    setCity(result.city ?? '')
    setWebsite(result.website ?? '')
    setEditWebsite(false)
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
    if (!canRun) return
    if (!followup && normalizedWebsite === null) return
    captureMarketing('tool_run_started', { tool: 'venues' })
    setRunError(null)
    setAttempt((n) => n + 1)
    setRanNoSite(followup !== null)
    setPhase('running')
    const res = await runVenueGrader(
      {
        name: effectiveName,
        city: effectiveCity,
        website: followup ? '' : (normalizedWebsite as string),
        ...(mode === 'selected' && selected ? { place_id: selected.id } : {}),
        // #4452 §6.2: only when asked and answered (otherwise the body is today's).
        ...(followup ? { followup } : {}),
      },
      { pid: 'tool_venues', utm: collectUtm() },
    )
    if (res.ok) {
      setRunId(res.run_id)
      // #4452 §6.4: the web lane answers the preview only.
      if (res.report) setReport(res.report)
      else if (res.preview) setPreview(res.preview)
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

  // ── REPORT ────────────────────────────────────────────────────────────────
  if (phase === 'report' && preview && !report && runId) {
    return (
      <ToolPage tool="venues" embedded={embedded} active={ranNoSite} left={(
        <PreviewGate
          tool="venues"
          preview={preview}
          runId={runId}
          resetLabel="← Grade another place"
          onReset={() => {
            setPhase('intake')
            setPreview(null)
            setRunId(null)
          }}
        />
      )} />
    )
  }
  if (phase === 'report' && report && runId) {
    return (
      <div className="tp-report">
        {embedded ? (
          null
        ) : (
          <button type="button" className="tp-ghost" onClick={() => { setPhase('intake'); setReport(null); setRunId(null) }}>
            ← Grade another place
          </button>
        )}
        <ReportView report={report} runId={runId} />
      </div>
    )
  }

  // ── RUNNING ───────────────────────────────────────────────────────────────
  if (phase === 'running') {
    return (
      <ToolPage tool="venues" embedded={embedded} active={ranNoSite} left={(
        <ResearchScreen
          key={attempt}
          tool="venues"
          active={ranNoSite}
          error={runError ? (
            <RunError
              error={runError}
              limitTitle="You’ve hit today’s limit"
              limitBody="The free grader is capped per day while it’s in test. Come back tomorrow and your report will be here."
              failBody="Something broke on our side while grading your place. Give it another go: it usually works the second time."
              onRetry={handleRun}
              onBack={resetToIntake}
            />
          ) : undefined}
        />
      )} />
    )
  }

  // ── INTAKE ────────────────────────────────────────────────────────────────
  const showList = mode === 'search' && query.trim().length >= 2 && (searching || results.length > 0)
  const siteHost = selected?.website ? hostOf(selected.website) : ''
  return (
    <ToolPage tool="venues" embedded={embedded} active={noSite} left={(
      <form className="tp-card" onSubmit={(e) => { e.preventDefault(); void handleRun() }} noValidate>
        <ToolField label="Your place" htmlFor="grader-place" tag="Google search">
          <input
            id="grader-place"
            className="fk-input"
            type="text"
            role="combobox"
            aria-expanded={showList}
            aria-autocomplete="list"
            aria-controls="grader-place-list"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
              if (e.key === 'Enter' && mode === 'search' && results[active]) { e.preventDefault(); selectResult(results[active]) }
            }}
            placeholder="Start typing your place’s name…"
          />
          {showList ? (
            <div className="tp-results" id="grader-place-list">
              {searching && results.length === 0 ? (
                <p className="fk-help" aria-live="polite" style={{ padding: 8 }}>Searching…</p>
              ) : (
                <ul role="listbox" aria-label="Places">
                  {results.map((result, i) => (
                    <li key={result.id} role="option" aria-selected={i === active}>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => selectResult(result)}>
                        {result.photo_url ? <img src={result.photo_url} alt="" /> : <span className="ini" aria-hidden="true">{result.name.slice(0, 1).toUpperCase()}</span>}
                        <span>
                          {result.name}
                          <small>{[result.city, result.website ? hostOf(result.website) : 'no website on Google'].filter(Boolean).join(' · ')}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </ToolField>

        {mode === 'selected' && selected ? (
          <div className="tp-placecard">
            {selected.photo_url ? <img className="im" src={selected.photo_url} alt="" /> : <span className="im" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
            <span>
              <b>{name}</b>
              <span>{city}</span>
              <br />
              <span>{siteHost ? `Website found: ${siteHost}` : 'No website on Google'}</span>
            </span>
            <button type="button" className="tp-link" onClick={switchToManual}>Edit</button>
          </div>
        ) : null}
        {mode === 'selected' ? (
          <p className="fk-help">We fill in the address and website from Google, so there&rsquo;s nothing else to type.</p>
        ) : null}

        {mode === 'selected' && (editWebsite || (siteHost === '' && website.trim() !== '')) ? (
          <ToolField label="Website" htmlFor="grader-website" optional={siteHost === ''}>
            <input id="grader-website" className="fk-input" type="url" inputMode="url" autoComplete="url" value={website}
              onChange={(e) => setWebsite(e.target.value)} placeholder="yourplace.com" aria-invalid={websiteInvalid} />
          </ToolField>
        ) : mode === 'selected' ? (
          <button type="button" className="tp-link" onClick={() => setEditWebsite(true)}>
            {siteHost ? 'Not your website? Change it' : 'Have a website Google doesn’t know? Add it'}
          </button>
        ) : null}

        {noSite ? (
          <FollowupBlock tool="venues">
            <ToolField label="Where do people find you today?" why={SCENARIO.venues.tag} id="grader-found-label">
              <Choice chips options={FOUND_VIA} value={foundVia} onChange={setFoundVia} labelledBy="grader-found-label" />
            </ToolField>
          </FollowupBlock>
        ) : null}

        {mode === 'manual' ? (
          <div className="tp-two">
            <ToolField label="City" htmlFor="grader-city">
              <input id="grader-city" className="fk-input" type="text" autoComplete="address-level2" value={city}
                onChange={(e) => setCity(e.target.value)} placeholder="e.g. London" />
            </ToolField>
            <ToolField label="Website" htmlFor="grader-website-manual">
              <input id="grader-website-manual" className="fk-input" type="url" inputMode="url" autoComplete="url" value={website}
                onChange={(e) => setWebsite(e.target.value)} placeholder="yourplace.com" aria-invalid={websiteInvalid} />
            </ToolField>
          </div>
        ) : null}
        {websiteInvalid ? <p className="fk-error" role="alert">Enter a valid website, like yourplace.com</p> : null}

        {mode === 'search' ? (
          <button type="button" className="tp-link" onClick={switchToManual}>Can&rsquo;t find your place? Add it yourself</button>
        ) : null}

        <button type="submit" className="tp-go" disabled={!canRun}>Grade my website →</button>
        <StillNeed missing={mode === 'search' ? [] : missing} />
        <p className="tp-tiny">Free. No account. We never change your site or post anything.</p>
      </form>
    )} />
  )
}
