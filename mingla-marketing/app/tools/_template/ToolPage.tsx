'use client'

// #4452 §6.1–6.3 — the one paper template for the four free tools (design ch. 4c):
// a hero (mono pill, serif headline with its italic half, the sub), the work
// area (the premium form card on the left, "What you'll get" marked Example on
// the right) and three steps. The site nav above (logo pill, Book a 20-min
// call) comes from the tools layout. Each tool's *Experience keeps its own
// state machine, API calls and analytics; this file is only the look and the
// shared pieces: the field shell, the follow-up block (which fires
// tool_followup_shown), the Google search lists and the research screen.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import './tools.css'
import '@/components/forms/forms.css'
import { formEvent } from '@/components/forms/form-events'
import { GoogleMapsAttribution } from '@/components/ui/google-maps-attribution'
import { searchCities, type CitySuggestion, type GrowthToolsError } from '@/lib/growth-tools-submit'
import {
  followupShownProps,
  researchLines,
  researchProgress,
  SCENARIO,
  TOOL_PAGE,
  type ToolKey,
} from '@/lib/tools/scenarios'

export function ToolPage({ tool, embedded = false, active = false, left }: {
  tool: ToolKey
  embedded?: boolean
  /** The adaptive question applies: the Example card shows the situation's numbers. */
  active?: boolean
  left: ReactNode
}) {
  const t = TOOL_PAGE[tool]
  return (
    <div className={`tp${embedded ? ' tp-embedded' : ''}`} data-tool-page={tool}>
      {embedded ? null : (
        <header className="tp-hero">
          <span className="tp-pill">{t.pill} · free</span>
          <h1>{t.h} <em>{t.em}</em></h1>
          <p>{t.sub}</p>
        </header>
      )}
      <div className="tp-work">
        {left}
        <GetCard tool={tool} active={active} />
      </div>
      {embedded ? null : (
        <ol className="tp-steps" aria-label="How it works">
          {t.steps.map(([a, b], i) => (
            <li key={a}><span className="n">0{i + 1}</span><b>{a}</b>{b}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** The design's getcard: what the report holds, with example numbers, labelled Example. */
export function GetCard({ tool, active }: { tool: ToolKey; active: boolean }) {
  const t = TOOL_PAGE[tool]
  const s = SCENARIO[tool]
  const metric = active ? s.getMetric : t.getMetric
  const rows = active ? s.getRows : t.getRows
  return (
    <aside className="tp-get" aria-label="What you'll get (example)">
      <span className="ex">Example</span>
      <span className="k">What you&rsquo;ll get</span>
      <h2>{active ? <>Your plan, <em>for your situation.</em></> : <>Your report, <em>in plain numbers.</em></>}</h2>
      <div className="tp-metric"><b>{metric[0]}</b><span>{metric[1]}</span></div>
      <dl className="tp-rows">
        {rows.map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}
      </dl>
    </aside>
  )
}

/** One field in the kit's look: the label (with an optional tag), the control, help. */
export function ToolField({ label, htmlFor, tag, why, optional, help, children, id }: {
  label: string
  htmlFor?: string
  /** A plain tag, e.g. "Google". */
  tag?: string
  /** The adaptive tag, "asked because …" (binding copy). */
  why?: string
  optional?: boolean
  help?: ReactNode
  children: ReactNode
  id?: string
}) {
  const labelInner = (
    <>
      {label}
      {optional ? <span className="fk-opt"> (optional)</span> : null}
      {tag ? <span className="tp-tag">{tag}</span> : null}
      {why ? <span className="tp-tag why">{why}</span> : null}
    </>
  )
  return (
    <div className="fk-field">
      {htmlFor ? <label className="fk-label" htmlFor={htmlFor} id={id}>{labelInner}</label> : <span className="fk-label" id={id}>{labelInner}</span>}
      {children}
      {help ? <p className="fk-help">{help}</p> : null}
    </div>
  )
}

/** Single-choice cards or chips (radiogroup), arrow keys move the pick. */
export function Choice<T extends string>({ options, value, onChange, labelledBy, chips = false, ariaLabel }: {
  options: ReadonlyArray<{ value: T; label: string; sub?: string }>
  value: T | null
  onChange: (v: T) => void
  labelledBy?: string
  ariaLabel?: string
  chips?: boolean
}) {
  return (
    <div className={chips ? 'fk-chips' : 'fk-cards'} role="radiogroup" aria-labelledby={labelledBy} aria-label={ariaLabel}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : undefined}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onChange(options[(i + 1) % options.length].value) }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onChange(options[(i - 1 + options.length) % options.length].value) }
          }}
        >
          {o.sub ? <><b style={{ display: 'block' }}>{o.label}</b><span className="fk-dim" style={{ fontSize: 13 }}>{o.sub}</span></> : o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The adaptive follow-up block (design .adapt). Mounting it means the question
 * is on screen, so it fires tool_followup_shown once (tool and reason only).
 */
export function FollowupBlock({ tool, children }: { tool: ToolKey; children: ReactNode }) {
  useEffect(() => {
    formEvent('tool_followup_shown', null, followupShownProps(tool))
  }, [tool])
  return <div className="tp-adapt" data-followup={SCENARIO[tool].reason}>{children}</div>
}

/**
 * Google city search (growth-tools-geocode): the list opens inline under the
 * field and pushes the form down (never an overlay), with Google's attribution.
 * A typed city is accepted too, so the search is an assist and never a gate.
 */
export function CitySearch({ id, value, chosen, onType, onPick, placeholder, prompt }: {
  id: string
  value: string
  chosen: boolean
  onType: (v: string) => void
  onPick: (label: string, hit: CitySuggestion) => void
  placeholder: string
  prompt: string
}) {
  const [hits, setHits] = useState<CitySuggestion[]>([])
  const [busy, setBusy] = useState(false)
  const [down, setDown] = useState(false)
  const [active, setActive] = useState(0)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => {
    const q = value.trim()
    if (chosen || q.length < 2) { setHits([]); setBusy(false); return }
    setBusy(true)
    const timer = setTimeout(async () => {
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller
      try {
        const res = await searchCities(q, controller.signal)
        if (controller.signal.aborted) return
        setBusy(false)
        if (res.ok) { setHits(res.cities); setDown(false); setActive(0) }
        else { setHits([]); if (res.error === 'network' || res.error === 'server') setDown(true) }
      } catch {
        // superseded by a newer keystroke
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [value, chosen])
  const pick = (hit: CitySuggestion) => {
    const label = hit.country ? `${hit.city}, ${hit.country}` : hit.region ? `${hit.city}, ${hit.region}` : hit.city
    setHits([])
    onPick(label, hit)
  }
  return (
    <>
      <div className="fk-prefixed" style={{ position: 'relative' }}>
        <input
          id={id}
          className="fk-input"
          type="text"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            if (e.key === 'Enter' && hits[active]) { e.preventDefault(); pick(hits[active]) }
            if (e.key === 'Escape' && hits.length) { e.preventDefault(); setHits([]) }
          }}
        />
        {chosen ? <span className="tp-ok" aria-label="Found on Google" style={{ position: 'absolute', right: 16 }}>✓</span> : null}
      </div>
      {hits.length > 0 ? (
        <div className="tp-results" id={`${id}-list`}>
          <ul role="listbox" aria-label={prompt}>
            {hits.map((hit, i) => (
              <li key={hit.label} role="option" aria-selected={i === active}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(hit)}>
                  <span className="ini" aria-hidden="true">◎</span>
                  <span>{hit.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="tp-gattr"><GoogleMapsAttribution /></div>
        </div>
      ) : null}
      {busy && hits.length === 0 ? <p className="fk-help" aria-live="polite">Searching Google…</p> : null}
      {down ? <p className="fk-help">City search is busy. Type it and we&rsquo;ll use it.</p> : null}
    </>
  )
}

const EXPECTED_MS: Record<ToolKey, number> = { venues: 60000, events: 30000, trips: 40000, pricing: 25000 }

/**
 * The research screen (§6.3): "Researching live · about 40 seconds", "Working
 * on it." (or the situation line), the checklist ticking on fixed fractions of
 * the expected time (never "done" before the response), the progress bar, and
 * "You can leave this page" only when an email is already known.
 */
export function ResearchScreen({ tool, active, situation, emailKnown = false, error }: {
  tool: ToolKey
  active: boolean
  situation?: string
  emailKnown?: boolean
  error?: ReactNode
}) {
  const lines = researchLines(tool, active, situation)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (error) return
    const start = Date.now()
    const timer = setInterval(() => setElapsed(Date.now() - start), 500)
    return () => clearInterval(timer)
  }, [error])
  if (error) return <div className="tp-card tp-err" role="alert">{error}</div>
  const { ticked, pct } = researchProgress(elapsed, EXPECTED_MS[tool], lines.length, false)
  return (
    <div className="tp-card" aria-busy="true">
      <span className="tp-mono">Researching live · about 40 seconds</span>
      <h2>{active ? (situation || SCENARIO[tool].runLine) : 'Working on it.'}</h2>
      <ul className="tp-run" aria-live="polite">
        {lines.map((line, i) => {
          const state = i < ticked ? 'ok' : i === ticked ? 'on' : 'wait'
          return (
            <li key={line}>
              <span className={`d ${state}`} aria-hidden="true">{state === 'ok' ? '✓' : ''}</span>
              <span>{line}{state === 'ok' ? <span className="sr-only"> (done)</span> : null}</span>
            </li>
          )
        })}
      </ul>
      <div className="tp-prog" role="progressbar" aria-label="Research progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
      {emailKnown ? <p className="tp-tiny">You can leave this page. We&rsquo;ll email the report too.</p> : null}
    </div>
  )
}

/** The run's error card (rate limit or failure), in the paper look. */
export function RunError({ error, limitTitle, limitBody, failBody, onRetry, onBack, limitCta }: {
  error: GrowthToolsError
  limitTitle: string
  limitBody: string
  failBody: string
  onRetry: () => void
  onBack: () => void
  limitCta?: ReactNode
}) {
  const limited = error === 'rate_limited'
  return (
    <>
      <h2>{limited ? limitTitle : <>That didn&rsquo;t work. <em>Try again.</em></>}</h2>
      <p>{limited ? limitBody : failBody}</p>
      <div className="tp-actions">
        {limited ? limitCta ?? null : <button type="button" className="tp-go" onClick={onRetry}>Try again</button>}
        <button type="button" className="tp-ghost" onClick={onBack}>Back</button>
      </div>
    </>
  )
}

/** "Still need: …" under the button, so a disabled button is never a mystery. */
export function StillNeed({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null
  return <p className="tp-need">Still need: <b>{missing.join(' · ')}</b></p>
}
