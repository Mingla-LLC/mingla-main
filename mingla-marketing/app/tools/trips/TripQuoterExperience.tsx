'use client'
// #1005 [Quote Any Trip] — the client state machine: intake → running → report.
//
// INTAKE — a pure, validated trip form (Google destination search, no DB match;
// a fresh trip isn't in any catalogue). RUNNING — the research screen while
// the run does live cost research + the pricing engine + synthesis (~20-30s).
// REPORT — the gated preview (web lane) or the full report (app lane).
//
// #4452 §6.1–6.3: on the paper template (design ch. 4c). A group of 16 or more
// is asked about a coach between stops and rooms (asked because groups over 15
// need transport); the quote is then re-priced per person with them.

import { useState } from 'react'
import { PreviewGate } from '../_preview/PreviewGate'
import { Choice, CitySearch, FollowupBlock, ResearchScreen, RunError, StillNeed, ToolField, ToolPage } from '../_template/ToolPage'
import type { ToolPreview } from '@/lib/growth-tools-submit'
import { captureMarketing } from '@/components/marketing/marketing-capture'
import { DeviceLink } from '@/components/cutout/device-link'
import { toolAttribution } from '@/lib/links-src'
import {
  runTripQuoter,
  type GrowthToolsError,
  type TripReport,
  type TripRunInput,
  type TripVibe,
} from '@/lib/growth-tools-submit'
import { followupActive, followupBody, followupMissing, SCENARIO, tripSituationLine, withFollowup, type FollowupAnswers } from '@/lib/tools/scenarios'
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

const CURRENCIES = ['USD', 'GBP', 'EUR', 'NGN', 'CAD', 'AUD', 'AED', 'ZAR', 'INR', 'NZD']

const VIBES: ReadonlyArray<{ value: TripVibe; label: string; sub: string }> = [
  { value: 'budget', label: 'Budget', sub: 'Value first' },
  { value: 'balanced', label: 'Balanced', sub: 'Comfortable' },
  { value: 'luxury', label: 'Luxury', sub: 'Premium' },
]

const INCLUDE_ITEMS: { key: 'stay' | 'activities' | 'meals' | 'transport'; label: string }[] = [
  { key: 'stay', label: 'Stay' },
  { key: 'activities', label: 'Activities' },
  { key: 'meals', label: 'Food & drink' },
  { key: 'transport', label: 'Local transport' },
]
const COACH: ReadonlyArray<{ value: 'yes' | 'no'; label: string }> = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
const ROOMS: ReadonlyArray<{ value: 'twin' | 'single'; label: string }> = [{ value: 'twin', label: 'Twin' }, { value: 'single', label: 'Single' }]

export function TripQuoterExperience({ embedded = false }: { readonly embedded?: boolean } = {}) {
  const [phase, setPhase] = useState<Phase>('intake')

  const [title, setTitle] = useState('')
  const [destination, setDestination] = useState('')
  const [destChosen, setDestChosen] = useState(false)
  const [departure, setDeparture] = useState('')
  const [startDate, setStartDate] = useState('')
  const [nights, setNights] = useState('')
  const [groupSize, setGroupSize] = useState('')
  const [vibe, setVibe] = useState<TripVibe>('balanced')
  const [vibeNote, setVibeNote] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [includes, setIncludes] = useState({ stay: true, activities: true, meals: true, transport: true })
  const [coach, setCoach] = useState<boolean | null>(null)
  const [rooms, setRooms] = useState<'twin' | 'single' | null>(null)

  const [runError, setRunError] = useState<GrowthToolsError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [runId, setRunId] = useState<string | null>(null)
  const [report, setReport] = useState<TripReport | null>(null)
  const [preview, setPreview] = useState<ToolPreview | null>(null)
  const [ranBig, setRanBig] = useState<string | null>(null)

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

  // #4452 §6.2: groups over 15 are asked about a coach and rooms.
  const facts = { tool: 'trips' as const, groupSize: groupValid ? Math.round(groupNum) : 0 }
  const asked = followupActive(facts)
  const answers: FollowupAnswers = { tool: 'trips', coach, rooms }

  const missing: string[] = []
  if (title.trim().length < 2) missing.push('trip name')
  if (!destValid) missing.push('destination')
  if (!dateValid) missing.push('a start date (today or later)')
  if (!nightsValid) missing.push('number of nights')
  if (!groupValid) missing.push('group size')
  if (asked) missing.push(...followupMissing(answers))
  const canRun = missing.length === 0

  async function handleRun() {
    if (!canRun) return
    captureMarketing('tool_run_started', { tool: 'trips' })
    setRunError(null)
    setAttempt((n) => n + 1)
    setRanBig(asked ? tripSituationLine(groupNum, coach, rooms) : null)
    setPhase('running')
    const base: TripRunInput = {
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
    // #4452 §6.2 / SC-136: without the new answers the body is today's.
    const input = withFollowup(base, followupBody(facts, answers)) as TripRunInput
    const res = await runTripQuoter(input, { pid: 'tool_trips', utm: collectUtm() })
    if (res.ok) {
      setRunId(res.run_id)
      // #4452 §6.4: the web lane answers the preview only.
      if (res.report) setReport(res.report)
      else if (res.preview) setPreview(res.preview)
      captureMarketing('tool_report_ready', { tool: 'trips', run_id: res.run_id })
      setPhase('report')
      return
    }
    setRunError(res.error)
  }

  // ── REPORT ──────────────────────────────────────────────────────────────
  if (phase === 'report' && preview && !report && runId) {
    return (
      <ToolPage tool="trips" embedded={embedded} active={ranBig !== null} left={(
        <PreviewGate
          tool="trips"
          preview={preview}
          runId={runId}
          resetLabel="← Quote another trip"
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
            ← Quote another trip
          </button>
        )}
        <TripReportView report={report} runId={runId} />
      </div>
    )
  }

  // ── RUNNING ─────────────────────────────────────────────────────────────
  if (phase === 'running') {
    return (
      <ToolPage tool="trips" embedded={embedded} active={ranBig !== null} left={(
        <ResearchScreen
          key={attempt}
          tool="trips"
          active={ranBig !== null}
          situation={ranBig ?? undefined}
          error={runError ? (
            <RunError
              error={runError}
              limitTitle="You’ve used your free quotes for today"
              limitBody="Come back tomorrow, or publish your trip on the Mingla app now to give clients a real place to book."
              failBody="Something broke while building your quote. Give it another go: it usually works the second time."
              onRetry={handleRun}
              onBack={() => { setRunError(null); setPhase('intake') }}
              limitCta={(
                <DeviceLink
                  surface="host"
                  attribution={toolAttribution('tool_trips')}
                  sameTab
                  onActivate={() => captureMarketing('tool_ratelimit_cta_click', { tool: 'trips' })}
                  className="tp-go"
                >
                  Publish your trip in Mingla Host
                </DeviceLink>
              )}
            />
          ) : undefined}
        />
      )} />
    )
  }

  // ── INTAKE ──────────────────────────────────────────────────────────────
  return (
    <ToolPage tool="trips" embedded={embedded} active={asked} left={(
      <form className="tp-card" onSubmit={(e) => { e.preventDefault(); void handleRun() }} noValidate>
        <ToolField label="Trip name" htmlFor="tp-title">
          <input id="tp-title" className="fk-input" type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Marrakech long weekend" />
        </ToolField>

        <ToolField label="Destination" htmlFor="tp-dest" tag="Google">
          <CitySearch id="tp-dest" value={destination} chosen={destChosen} placeholder="Start typing a city or country…" prompt="Destinations"
            onType={(v) => { setDestination(v); if (destChosen) setDestChosen(false) }}
            onPick={(label) => { setDestination(label); setDestChosen(true) }} />
        </ToolField>

        <ToolField label="Start date" htmlFor="tp-date">
          <input id="tp-date" className="fk-input" type="date" value={startDate} min={todayStr} onChange={(e) => setStartDate(e.target.value)} />
        </ToolField>

        <div className="tp-two">
          <ToolField label="Nights" htmlFor="tp-nights">
            <input id="tp-nights" className="fk-input" type="number" inputMode="numeric" min={1} value={nights} onChange={(e) => setNights(e.target.value)} placeholder="4" />
          </ToolField>
          <ToolField label="People" htmlFor="tp-group">
            <input id="tp-group" className="fk-input" type="number" inputMode="numeric" min={1} value={groupSize} onChange={(e) => setGroupSize(e.target.value)} placeholder="10" />
          </ToolField>
        </div>

        {asked ? (
          <FollowupBlock tool="trips">
            <div className="tp-two">
              <ToolField label="Coach between stops?" why={SCENARIO.trips.tag} id="tp-coach-label">
                <Choice chips options={COACH} value={coach === null ? null : coach ? 'yes' : 'no'} onChange={(v) => setCoach(v === 'yes')} labelledBy="tp-coach-label" />
              </ToolField>
              <ToolField label="Rooms" id="tp-rooms-label">
                <Choice chips options={ROOMS} value={rooms} onChange={setRooms} labelledBy="tp-rooms-label" />
              </ToolField>
            </div>
          </FollowupBlock>
        ) : null}

        <ToolField label="Style" id="tp-style-label">
          <Choice options={VIBES} value={vibe} onChange={setVibe} labelledBy="tp-style-label" />
        </ToolField>

        <ToolField label="Currency" htmlFor="tp-currency">
          <select id="tp-currency" className="fk-input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </ToolField>

        <details>
          <summary className="tp-link" style={{ listStyle: 'none' }}>+ Departure city, style notes and what&rsquo;s included (sharpens the quote)</summary>
          <div style={{ display: 'grid', gap: 16, marginTop: 14 }}>
            <div className="tp-two">
              <ToolField label="Departing from" htmlFor="tp-departure" optional>
                <input id="tp-departure" className="fk-input" type="text" value={departure} onChange={(e) => setDeparture(e.target.value)} placeholder="e.g. London" />
              </ToolField>
              <ToolField label="Style notes" htmlFor="tp-note" optional>
                <input id="tp-note" className="fk-input" type="text" value={vibeNote} onChange={(e) => setVibeNote(e.target.value)} placeholder="e.g. foodie, no early starts" />
              </ToolField>
            </div>
            <ToolField label="What the price should include" id="tp-inc-label" help="Flights are never included: we price the trip on the ground.">
              <div className="fk-chips" role="group" aria-labelledby="tp-inc-label">
                {INCLUDE_ITEMS.map((item) => {
                  const on = includes[item.key]
                  return (
                    <button key={item.key} type="button" aria-pressed={on} className={on ? 'on' : undefined}
                      onClick={() => setIncludes((s) => ({ ...s, [item.key]: !s[item.key] }))}>
                      {on ? '✓ ' : ''}{item.label}
                    </button>
                  )
                })}
              </div>
            </ToolField>
          </div>
        </details>

        <button type="submit" className="tp-go" disabled={!canRun}>Quote this trip →</button>
        <StillNeed missing={missing} />
        <p className="tp-tiny">Free. No account. Prices are current estimates, not guaranteed rates.</p>
      </form>
    )} />
  )
}
