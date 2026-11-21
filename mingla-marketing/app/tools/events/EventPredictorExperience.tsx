'use client'
// #1004 [Event Turnout Predictor] — the client state machine: intake → running
// → report.
//
// INTAKE — a pure, validated event form (no DB search; a fresh event isn't in
// any catalogue). RUNNING — the research screen while the run does live
// external research + the budget engine + synthesis (~15-30s). REPORT — the
// gated preview (web lane) or the full report (app lane).
//
// #4452 §6.1–6.3: on the paper template (design ch. 4c). "Free, RSVP only"
// hides the ticket price and asks the RSVP goal and no-show history (asked
// because it's free); the forecast is then the show-up rate and RSVPs to aim for.

import { CalendarInput } from '@mingla/calendar-web'
import '@mingla/calendar-web/calendar.css'
import { useState } from 'react'
import { PreviewGate } from '../_preview/PreviewGate'
import { Choice, CitySearch, FollowupBlock, ResearchScreen, RunError, StillNeed, ToolField, ToolPage } from '../_template/ToolPage'
import type { ToolPreview } from '@/lib/growth-tools-submit'
import { captureMarketing } from '@/components/marketing/marketing-capture'
import { DeviceLink } from '@/components/cutout/device-link'
import { toolAttribution } from '@/lib/links-src'
import {
  runEventPredictor,
  type EventReport,
  type EventRunInput,
  type GrowthToolsError,
} from '@/lib/growth-tools-submit'
import { followupActive, followupBody, followupMissing, hiddenFields, SCENARIO, withFollowup, type FollowupAnswers } from '@/lib/tools/scenarios'
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
const SETTINGS: ReadonlyArray<{ value: InOut; label: string }> = [
  { value: 'indoor', label: 'Indoor' }, { value: 'outdoor', label: 'Outdoor' }, { value: 'mixed', label: 'Mixed' },
]
const TICKETS: ReadonlyArray<{ value: 'paid' | 'free'; label: string }> = [
  { value: 'paid', label: 'Paid tickets' }, { value: 'free', label: 'Free, RSVP only' },
]
const NO_SHOWS: ReadonlyArray<{ value: 'lots' | 'few'; label: string }> = [
  { value: 'lots', label: 'Yes, lots' }, { value: 'few', label: 'A few' },
]

export function EventPredictorExperience({ embedded = false }: { readonly embedded?: boolean } = {}) {
  const [phase, setPhase] = useState<Phase>('intake')

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [city, setCity] = useState('')
  const [cityChosen, setCityChosen] = useState(false)
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
  const [rsvpGoal, setRsvpGoal] = useState('')
  const [noShows, setNoShows] = useState<'lots' | 'few' | null>(null)

  const [runError, setRunError] = useState<GrowthToolsError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [runId, setRunId] = useState<string | null>(null)
  const [report, setReport] = useState<EventReport | null>(null)
  const [preview, setPreview] = useState<ToolPreview | null>(null)
  const [ranFree, setRanFree] = useState(false)

  // #4452 §6.2: "Free, RSVP only" is the situation the form adapts to.
  const facts = { tool: 'events' as const, free: isFree }
  const asked = followupActive(facts)
  const hidden = hiddenFields(facts)
  const answers: FollowupAnswers = { tool: 'events', rsvp_goal: rsvpGoal, no_shows: noShows }

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

  // Everything still required — surfaced under the button so a disabled state
  // is never a mystery.
  const missing: string[] = []
  if (title.trim().length < 2) missing.push('event name')
  if (category.trim().length < 2) missing.push('event type')
  if (!cityValid) missing.push('city')
  if (!dateValid) missing.push('a date (today or later)')
  if (!capacityValid) missing.push('capacity')
  if (asked) missing.push(...followupMissing(answers))
  const canRun = missing.length === 0

  async function handleRun() {
    if (!canRun) return
    captureMarketing('tool_run_started', { tool: 'events' })
    setRunError(null)
    setAttempt((n) => n + 1)
    setRanFree(asked)
    setPhase('running')
    const base: EventRunInput = {
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
    // #4452 §6.2 / SC-136: without the new answers the body is today's.
    const input = withFollowup(base, followupBody(facts, answers)) as EventRunInput
    const res = await runEventPredictor(input, { pid: 'tool_events', utm: collectUtm() })
    if (res.ok) {
      setRunId(res.run_id)
      // #4452 §6.4: the web lane answers the preview only.
      if (res.report) setReport(res.report)
      else if (res.preview) setPreview(res.preview)
      captureMarketing('tool_report_ready', { tool: 'events', run_id: res.run_id })
      setPhase('report')
      return
    }
    setRunError(res.error)
  }

  // ── REPORT ──────────────────────────────────────────────────────────────
  if (phase === 'report' && preview && !report && runId) {
    return (
      <ToolPage tool="events" embedded={embedded} active={ranFree} left={(
        <PreviewGate
          tool="events"
          preview={preview}
          runId={runId}
          resetLabel="← Forecast another event"
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
            ← Forecast another event
          </button>
        )}
        <EventReportView report={report} runId={runId} />
      </div>
    )
  }

  // ── RUNNING ─────────────────────────────────────────────────────────────
  if (phase === 'running') {
    return (
      <ToolPage tool="events" embedded={embedded} active={ranFree} left={(
        <ResearchScreen
          key={attempt}
          tool="events"
          active={ranFree}
          error={runError ? (
            <RunError
              error={runError}
              limitTitle="You’ve used your free forecasts for today"
              limitBody="Come back tomorrow, or create your event on the Mingla app now to see full turnout insights as it fills."
              failBody="Something broke while building your forecast. Give it another go: it usually works the second time."
              onRetry={handleRun}
              onBack={() => { setRunError(null); setPhase('intake') }}
              limitCta={(
                <DeviceLink
                  surface="host"
                  attribution={toolAttribution('tool_events')}
                  sameTab
                  onActivate={() => captureMarketing('tool_ratelimit_cta_click', { tool: 'events' })}
                  className="tp-go"
                >
                  Create your event in Mingla Host
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
    <ToolPage tool="events" embedded={embedded} active={asked} left={(
      <form className="tp-card" onSubmit={(e) => { e.preventDefault(); void handleRun() }} noValidate>
        <ToolField label="Event name" htmlFor="ev-title">
          <input id="ev-title" className="fk-input" type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Afrobeats Rooftop Sessions" />
        </ToolField>

        <ToolField label="Type" id="ev-category-label">
          <Choice chips options={CATEGORIES.map((c) => ({ value: c, label: c }))} value={category} onChange={setCategory} labelledBy="ev-category-label" />
        </ToolField>

        <div className="tp-two">
          <ToolField label="City" htmlFor="ev-city" tag="Google">
            <CitySearch id="ev-city" value={city} chosen={cityChosen} placeholder="Start typing your city…" prompt="Cities"
              onType={(v) => { setCity(v); if (cityChosen) setCityChosen(false) }}
              onPick={(label) => { setCity(label); setCityChosen(true) }} />
          </ToolField>
          <ToolField label="Venue" htmlFor="ev-venue" optional>
            <input id="ev-venue" className="fk-input" type="text" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Skylight Rooftop" />
          </ToolField>
        </div>

        <div className="tp-two">
          <ToolField label="Date" htmlFor="ev-date">
            <CalendarInput id="ev-date" className="fk-input" mode="date" value={date} min={todayStr} aria-label="Date" onChange={(e) => setDate(e.target.value)} />
          </ToolField>
          <ToolField label="Start time" htmlFor="ev-time">
            <input id="ev-time" className="fk-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </ToolField>
        </div>

        <ToolField label="Setting" id="ev-setting-label">
          <Choice chips options={SETTINGS} value={inout} onChange={setInout} labelledBy="ev-setting-label" />
        </ToolField>

        <ToolField label="Tickets" id="ev-tickets-label">
          <Choice options={TICKETS} value={isFree ? 'free' : 'paid'} onChange={(v) => setIsFree(v === 'free')} labelledBy="ev-tickets-label" />
        </ToolField>

        <div className="tp-two">
          <ToolField label="Capacity" htmlFor="ev-capacity">
            <input id="ev-capacity" className="fk-input" type="number" inputMode="numeric" min={1} value={capacity}
              onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 400" />
          </ToolField>
          {hidden.includes('ticket_price') ? (
            <ToolField label="Promo budget" htmlFor="ev-budget" optional help="Tell us your spend and we’ll show what it buys. Leave blank for organic only.">
              <div className="fk-prefixed">
                <select aria-label="Currency" className="fk-country" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input id="ev-budget" className="fk-input" type="number" inputMode="decimal" min={0} value={budget}
                  onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 400" />
              </div>
            </ToolField>
          ) : (
            <ToolField label="Ticket price" htmlFor="ev-price" help="No budget needed: we’ll recommend the ad spend that makes you the most profit.">
              <div className="fk-prefixed">
                <select aria-label="Currency" className="fk-country" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input id="ev-price" className="fk-input" type="number" inputMode="decimal" min={0} value={price}
                  onChange={(e) => setPrice(e.target.value)} placeholder="25" />
              </div>
            </ToolField>
          )}
        </div>

        {asked ? (
          <FollowupBlock tool="events">
            <div className="tp-two">
              <ToolField label="RSVP goal" htmlFor="ev-rsvp" why={SCENARIO.events.tag}>
                <input id="ev-rsvp" className="fk-input" type="number" inputMode="numeric" min={1} value={rsvpGoal}
                  onChange={(e) => setRsvpGoal(e.target.value)} placeholder="e.g. 400" />
              </ToolField>
              <ToolField label="Had no-shows before?" id="ev-noshow-label">
                <Choice chips options={NO_SHOWS} value={noShows} onChange={setNoShows} labelledBy="ev-noshow-label" />
              </ToolField>
            </div>
          </FollowupBlock>
        ) : null}

        <details>
          <summary className="tp-link" style={{ listStyle: 'none' }}>+ Add lineup and audience size (sharpens the forecast)</summary>
          <div className="tp-two" style={{ marginTop: 14 }}>
            <ToolField label="Lineup or host" htmlFor="ev-lineup" optional>
              <input id="ev-lineup" className="fk-input" type="text" value={lineup} onChange={(e) => setLineup(e.target.value)} placeholder="e.g. DJ Spinall and guests" />
            </ToolField>
            <ToolField label="Your audience size" htmlFor="ev-audience" optional>
              <input id="ev-audience" className="fk-input" type="number" inputMode="numeric" min={0} value={audience}
                onChange={(e) => setAudience(e.target.value)} placeholder="Followers or email list" />
            </ToolField>
          </div>
        </details>

        <button type="submit" className="tp-go" disabled={!canRun}>Forecast my turnout →</button>
        <StillNeed missing={missing} />
        <p className="tp-tiny">Free. No account. We research your event live and email your full forecast.</p>
      </form>
    )} />
  )
}
