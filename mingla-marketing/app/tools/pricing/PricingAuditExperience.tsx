'use client'
// #1006 [The Undercharging Audit] — the client state machine: intake → running
// → report.
//
// INTAKE — a validated experience form (Google city search). RUNNING — the
// research screen while the run researches comparable prices + the cost engine
// + synthesis (~15-25s). REPORT — the gated preview (web lane) or the full
// report (app lane).
//
// #4452 §6.1–6.3, §6.6: on the paper template (design ch. 4c). The category is
// choice cards with no default (a pick is required). "Free right now" hides the
// current price and asks what each session costs and whether guests would pay
// a deposit (asked because it's free today).

import { useState } from 'react'
import { PreviewGate } from '../_preview/PreviewGate'
import { Choice, CitySearch, FollowupBlock, ResearchScreen, RunError, StillNeed, ToolField, ToolPage } from '../_template/ToolPage'
import type { ToolPreview } from '@/lib/growth-tools-submit'
import { captureMarketing } from '@/components/marketing/marketing-capture'
import { DeviceLink } from '@/components/cutout/device-link'
import { toolAttribution } from '@/lib/links-src'
import {
  runPricingAudit,
  type GrowthToolsError,
  type PricingReport,
  type PricingRunInput,
} from '@/lib/growth-tools-submit'
import { followupActive, followupBody, followupMissing, hiddenFields, SCENARIO, withFollowup, type FollowupAnswers } from '@/lib/tools/scenarios'
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
const CHARGES: ReadonlyArray<{ value: 'paid' | 'free'; label: string }> = [
  { value: 'paid', label: 'I charge for it' }, { value: 'free', label: 'Free right now' },
]
const DEPOSIT: ReadonlyArray<{ value: 'probably' | 'not_sure'; label: string }> = [
  { value: 'probably', label: 'Probably' }, { value: 'not_sure', label: 'Not sure' },
]

export function PricingAuditExperience({ embedded = false }: { readonly embedded?: boolean } = {}) {
  const [phase, setPhase] = useState<Phase>('intake')

  const [description, setDescription] = useState('')
  // #4452 §6.6: no default; a pick is required.
  const [category, setCategory] = useState('')
  const [city, setCity] = useState('')
  const [cityChosen, setCityChosen] = useState(false)

  const [seats, setSeats] = useState('')
  const [price, setPrice] = useState('')
  const [isFree, setIsFree] = useState(false)
  const [currency, setCurrency] = useState('USD')
  const [perMonth, setPerMonth] = useState('')
  const [venueCost, setVenueCost] = useState('')
  const [materialsCost, setMaterialsCost] = useState('')
  const [ownHours, setOwnHours] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [sessionCost, setSessionCost] = useState('')
  const [deposit, setDeposit] = useState<'probably' | 'not_sure' | null>(null)

  const [runError, setRunError] = useState<GrowthToolsError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [runId, setRunId] = useState<string | null>(null)
  const [report, setReport] = useState<PricingReport | null>(null)
  const [preview, setPreview] = useState<ToolPreview | null>(null)
  const [ranFree, setRanFree] = useState(false)

  // #4452 §6.2: "Free right now" is the situation the form adapts to.
  const facts = { tool: 'pricing' as const, free: isFree }
  const asked = followupActive(facts)
  const hidden = hiddenFields(facts)
  const answers: FollowupAnswers = { tool: 'pricing', session_cost: sessionCost, deposit }

  const seatsNum = Number(seats)
  const seatsValid = Number.isFinite(seatsNum) && seatsNum >= 1
  const priceNum = Number(price)
  // A currently-FREE experience (0) is valid — it's the ultimate under-charger.
  const priceValid = isFree || (price.trim() !== '' && Number.isFinite(priceNum) && priceNum >= 0)
  const perMonthNum = Number(perMonth)
  const perMonthValid = Number.isFinite(perMonthNum) && perMonthNum >= 1
  const cityValid = cityChosen || city.trim().length >= 2

  const missing: string[] = []
  if (description.trim().length < 4) missing.push('what your experience is')
  if (!category) missing.push('what kind it is')
  if (!cityValid) missing.push('city')
  if (!seatsValid) missing.push('seats per event')
  if (!priceValid) missing.push('your current price (or mark it free)')
  if (!perMonthValid) missing.push('how often you run it')
  if (asked) missing.push(...followupMissing(answers))
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
    setRanFree(asked)
    setPhase('running')
    const base: PricingRunInput = {
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
    // #4452 §6.2 / SC-136: without the new answers the body is today's.
    const input = withFollowup(base, followupBody(facts, answers)) as PricingRunInput
    const res = await runPricingAudit(input, { pid: 'tool_pricing', utm: collectUtm() })
    if (res.ok) {
      setRunId(res.run_id)
      // #4452 §6.4: the web lane answers the preview only.
      if (res.report) setReport(res.report)
      else if (res.preview) setPreview(res.preview)
      captureMarketing('tool_report_ready', { tool: 'experiences', run_id: res.run_id })
      setPhase('report')
      return
    }
    setRunError(res.error)
  }

  // ── REPORT ──────────────────────────────────────────────────────────────
  if (phase === 'report' && preview && !report && runId) {
    return (
      <ToolPage tool="pricing" embedded={embedded} active={ranFree} left={(
        <PreviewGate
          tool="experiences"
          preview={preview}
          runId={runId}
          resetLabel="← Audit another experience"
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
            ← Audit another experience
          </button>
        )}
        <PricingReportView report={report} runId={runId} />
      </div>
    )
  }

  // ── RUNNING ─────────────────────────────────────────────────────────────
  if (phase === 'running') {
    return (
      <ToolPage tool="pricing" embedded={embedded} active={ranFree} left={(
        <ResearchScreen
          key={attempt}
          tool="pricing"
          active={ranFree}
          error={runError ? (
            <RunError
              error={runError}
              limitTitle="You’ve used your free audits for today"
              limitBody="Come back tomorrow, or relaunch your experience at the right price on the Mingla app now, with all-in checkout."
              failBody="Something broke while building your audit. Give it another go: it usually works the second time."
              onRetry={handleRun}
              onBack={() => { setRunError(null); setPhase('intake') }}
              limitCta={(
                <DeviceLink
                  surface="host"
                  attribution={toolAttribution('tool_pricing')}
                  sameTab
                  onActivate={() => captureMarketing('tool_ratelimit_cta_click', { tool: 'experiences' })}
                  className="tp-go"
                >
                  Relaunch in Mingla Host
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
    <ToolPage tool="pricing" embedded={embedded} active={asked} left={(
      <form className="tp-card" onSubmit={(e) => { e.preventDefault(); void handleRun() }} noValidate>
        <ToolField label="What’s your experience?" htmlFor="pr-desc">
          <textarea id="pr-desc" className="fk-input fk-area" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. A hands-on pasta-making supper club with wine pairing" maxLength={400} />
        </ToolField>

        <ToolField label="Type" id="pr-category-label">
          {/* #4452 §6.6: choice cards with no default; a pick is required. */}
          <div id="pr-category" role="radiogroup" aria-label="Type" className="fk-chips" data-category-cards="">
            {CATEGORIES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={category === c} onClick={() => setCategory(c)}
                className={category === c ? 'on' : undefined}>
                {c}
              </button>
            ))}
          </div>
        </ToolField>

        <div className="tp-two">
          <ToolField label="City" htmlFor="pr-city" tag="Google">
            <CitySearch id="pr-city" value={city} chosen={cityChosen} placeholder="Start typing your city…" prompt="Cities"
              onType={(v) => { setCity(v); if (cityChosen) setCityChosen(false) }}
              onPick={(label) => { setCity(label); setCityChosen(true) }} />
          </ToolField>
          <ToolField label="Seats" htmlFor="pr-seats" help="Guests per event.">
            <input id="pr-seats" className="fk-input" type="number" inputMode="numeric" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="12" />
          </ToolField>
        </div>

        <ToolField label="Do you charge for it now?" id="pr-charge-label">
          <Choice options={CHARGES} value={isFree ? 'free' : 'paid'} onChange={(v) => setIsFree(v === 'free')} labelledBy="pr-charge-label" />
        </ToolField>

        <div className="tp-two">
          {hidden.includes('current_price') ? (
            <ToolField label="Currency" htmlFor="pr-currency">
              <select id="pr-currency" className="fk-input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </ToolField>
          ) : (
            <ToolField label="Your price now" htmlFor="pr-price" help="Per person.">
              <div className="fk-prefixed">
                <select aria-label="Currency" className="fk-country" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input id="pr-price" aria-label="Current price per person" className="fk-input" type="number" inputMode="decimal" min={0} value={price}
                  onChange={(e) => setPrice(e.target.value)} placeholder="35" />
              </div>
            </ToolField>
          )}
          <ToolField label="Times a month" htmlFor="pr-permonth">
            <input id="pr-permonth" className="fk-input" type="number" inputMode="numeric" min={1} value={perMonth} onChange={(e) => setPerMonth(e.target.value)} placeholder="4" />
          </ToolField>
        </div>

        {asked ? (
          <FollowupBlock tool="pricing">
            <div className="tp-two">
              <ToolField label="What does each session cost you?" htmlFor="pr-session" why={SCENARIO.pricing.tag}>
                <div className="fk-prefixed">
                  <span className="fk-country" style={{ display: 'inline-flex', alignItems: 'center' }}>{currency}</span>
                  <input id="pr-session" className="fk-input" type="number" inputMode="decimal" min={0} value={sessionCost}
                    onChange={(e) => setSessionCost(e.target.value)} placeholder="370" />
                </div>
              </ToolField>
              <ToolField label="Would guests pay a deposit?" id="pr-deposit-label">
                <Choice chips options={DEPOSIT} value={deposit} onChange={setDeposit} labelledBy="pr-deposit-label" />
              </ToolField>
            </div>
          </FollowupBlock>
        ) : null}

        <details>
          <summary className="tp-link" style={{ listStyle: 'none' }}>+ Add your costs and time (sharpens the audit)</summary>
          <div style={{ display: 'grid', gap: 16, marginTop: 14 }}>
            <div className="tp-two">
              <ToolField label="Venue or space cost (per event)" htmlFor="pr-venue" optional>
                <input id="pr-venue" className="fk-input" type="number" inputMode="decimal" min={0} value={venueCost} onChange={(e) => setVenueCost(e.target.value)} placeholder={`${currency} 0`} />
              </ToolField>
              <ToolField label="Materials or supplies (per event)" htmlFor="pr-materials" optional>
                <input id="pr-materials" className="fk-input" type="number" inputMode="decimal" min={0} value={materialsCost} onChange={(e) => setMaterialsCost(e.target.value)} placeholder={`${currency} 0`} />
              </ToolField>
            </div>
            <div className="tp-two">
              <ToolField label="Your hours (per event)" htmlFor="pr-hours" optional>
                <input id="pr-hours" className="fk-input" type="number" inputMode="decimal" min={0} value={ownHours} onChange={(e) => setOwnHours(e.target.value)} placeholder="5" />
              </ToolField>
              <ToolField label={`Your time is worth (${currency} an hour)`} htmlFor="pr-rate" optional>
                <input id="pr-rate" className="fk-input" type="number" inputMode="decimal" min={0} value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="25" />
              </ToolField>
            </div>
            <p className="fk-help">Leave any blank and we&rsquo;ll estimate it from live research, and label it as estimated in your audit.</p>
          </div>
        </details>

        <button type="submit" className="tp-go" disabled={!canRun}>Audit my pricing →</button>
        <StillNeed missing={missing} />
        <p className="tp-tiny">Free. No account. We research real comparable prices and email your full audit.</p>
      </form>
    )} />
  )
}
