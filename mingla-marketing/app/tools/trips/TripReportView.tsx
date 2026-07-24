'use client'
// #1005 [Quote Any Trip] — the report document.
//
// A parchment "document card" on the dark /tools stage (data-theme="light").
// FREE zone: the trip header + the big PER-PERSON PRICE + group total + headline.
// GATED zone (blur + gate overlay): the cost sheet, margin ladder (what to
// charge), day-by-day itinerary, named hotels, comparable trips, the fill/ad
// plan, weather + demand, and the fixes — revealed only via the emailed tokenized
// link. Once ungated the consolidated offer closes to /schedule + publish.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/cn'
import { buttonClasses } from '@/components/ui/button'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import {
  submitGrowthToolsGate,
  type TripFactor,
  type TripPricingPlan,
  type TripReport,
  type TripScenario,
  type GrowthToolsError,
} from '@/lib/growth-tools-submit'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const GATE_ERROR_COPY: Record<GrowthToolsError, string> = {
  rate_limited: 'You’ve hit today’s limit — try again tomorrow.',
  generation_failed: 'That didn’t work — try again.',
  validation: 'Enter a valid email address.',
  server: 'That didn’t work — try again.',
  network: 'We couldn’t reach our servers — check your connection and try again.',
  booking_unconfigured: 'That didn’t work — try again.',
  slot_taken: 'That time was just taken — pick another.',
  calendar_unavailable: 'That didn’t work — try again.',
}

const FACTOR_STYLE: Record<TripFactor['status'], { mark: string; className: string }> = {
  help: { mark: '↑', className: 'border-moss/40 bg-moss/12 text-moss' },
  watch: { mark: '~', className: 'border-butter/50 bg-butter/15 text-warning' },
  hurt: { mark: '↓', className: 'border-danger/30 bg-danger/10 text-danger' },
}

const EFFORT_CHIP: Record<string, string> = {
  this_week: 'This week',
  this_month: 'This month',
  project: 'Bigger project',
}

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: n < 100 && !Number.isInteger(n) ? 2 : 0,
    }).format(n)
  } catch {
    return `${currency} ${Math.round(n)}`
  }
}

function DocHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
      {children}
    </h2>
  )
}

// A generic disclaimer only — never expose the CPC / conversion assumptions.
function EstimateNote({ checkedOn, note }: { checkedOn?: string; note?: string }) {
  return (
    <p className="mt-3 text-xs leading-relaxed text-text-muted">
      {note || 'Prices are current estimates from live research — not guaranteed rates.'}
      {checkedOn ? ` Checked ${checkedOn}.` : ''}
    </p>
  )
}

// ── Price hero: the per-person price + group total + confidence ──────────────
function PriceHero({ report }: { report: TripReport }) {
  const p = report.plan
  const cur = p.currency
  const confColor = report.confidence === 'high'
    ? 'bg-moss/15 text-moss'
    : report.confidence === 'low'
      ? 'bg-danger/10 text-danger'
      : 'bg-butter/20 text-warning'
  return (
    <div className="rounded-md border border-divider-strong bg-stripe p-6 text-center md:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
        Charge per person
      </p>
      <p className="mt-2 font-display text-[clamp(2.4rem,8vw,4rem)] leading-none text-text-primary">
        {money(p.recommended_price_per_person, cur)}
      </p>
      <p className="mt-1 text-sm font-semibold text-text-secondary">
        {money(p.group_price, cur)} for your group of {p.group_size} ·{' '}
        <span className="text-moss">{money(p.group_profit, cur)} profit</span>
      </p>
      <p className="mt-1 text-xs text-text-muted">
        Built from {money(p.cost_per_person, cur)}/person real cost at a{' '}
        {p.recommended_margin_pct}% margin
      </p>
      <div className="mt-4 inline-flex items-center gap-2">
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize', confColor)}>
          {report.confidence} confidence
        </span>
      </div>
      {report.headline_read ? (
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-text-secondary md:text-base">
          {report.headline_read}
        </p>
      ) : null}
    </div>
  )
}

// Small stat cell used across the warm cards.
function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="rounded-md bg-white/12 p-3">
      <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-white/70">{k}</p>
      <p className="mt-1 text-lg font-bold">{v}</p>
      {sub ? <p className="text-[0.7rem] text-white/70">{sub}</p> : null}
    </div>
  )
}

// ── The bottom line — decision-first summary ─────────────────────────────────
function DecisionBox({ report }: { report: TripReport }) {
  const p = report.plan
  const cur = p.currency
  const topFix = report.fixes[0]
  const risk = report.factors.find((x) => x.status === 'hurt') ??
    report.factors.find((x) => x.status === 'watch')
  return (
    <div className="rounded-md border-2 border-warm/30 bg-warm/[0.06] p-5 md:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-warm">The bottom line</p>
      <p className="mt-2 text-base leading-relaxed text-text-primary md:text-lg">
        Charge <span className="font-bold">{money(p.recommended_price_per_person, cur)}</span> a head
        — that clears <span className="font-bold">{money(p.profit_per_person, cur)}</span> profit each,
        about <span className="font-bold">{money(p.group_profit, cur)}</span> across{' '}
        {p.group_size} people at a <span className="font-bold">{p.recommended_margin_pct}% margin</span>.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {topFix ? (
          <div className="rounded-md bg-white p-3">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-moss">Best move</p>
            <p className="mt-0.5 text-sm font-semibold text-text-primary">{topFix.title}</p>
          </div>
        ) : null}
        {risk ? (
          <div className="rounded-md bg-white p-3">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-warning">Watch out for</p>
            <p className="mt-0.5 text-sm font-semibold text-text-primary">{risk.label}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── The cost sheet — line items → cost per person → what to charge ───────────
function CostSheet({ report }: { report: TripReport }) {
  const p = report.plan
  const cur = p.currency
  return (
    <div className="rounded-md border border-divider-strong bg-white p-5">
      <DocHeading>Your cost sheet (per person)</DocHeading>
      <div className="mt-3 divide-y divide-divider">
        {p.cost_lines.map((line) => (
          <div key={line.key} className="flex items-baseline justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary">{line.label}</p>
              {line.basis ? <p className="text-xs text-text-muted">{line.basis}</p> : null}
            </div>
            <p className="shrink-0 text-sm font-bold text-text-primary tabular-nums">
              {money(line.per_person, cur)}
            </p>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 py-2.5">
          <p className="text-sm font-bold text-text-primary">Cost per person</p>
          <p className="shrink-0 text-base font-bold text-text-primary tabular-nums">
            {money(p.cost_per_person, cur)}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-warm/10 px-3 py-2.5">
        <div>
          <p className="text-sm font-bold text-warm-ink">What to charge</p>
          <p className="text-xs text-text-secondary">at a {p.recommended_margin_pct}% margin</p>
        </div>
        <p className="shrink-0 text-lg font-bold text-warm-ink tabular-nums">
          {money(p.recommended_price_per_person, cur)}
        </p>
      </div>
      <EstimateNote checkedOn={report.price_basis?.checked_on} note={report.price_basis?.note} />
    </div>
  )
}

// ── Margin ladder — what to charge at each margin (the pricing tool) ─────────
function MarginLadder({ plan }: { plan: TripPricingPlan }) {
  if (plan.margin_tiers.length === 0) return null
  const cur = plan.currency
  return (
    <div className="mt-8">
      <DocHeading>What to charge</DocHeading>
      <p className="mt-1 text-sm text-text-secondary">{plan.price_vs_market}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {plan.margin_tiers.map((t) => (
          <div
            key={t.margin_pct}
            className={cn(
              'rounded-md border p-4 text-center',
              t.recommended ? 'border-warm bg-warm/10' : 'border-divider-strong bg-white',
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {t.recommended ? '★ ' : ''}{t.margin_pct}% margin
            </p>
            <p className="mt-1 font-display text-2xl text-text-primary">
              {money(t.price_per_person, cur)}
            </p>
            <p className="text-[0.7rem] text-text-muted">per person</p>
            <p className="mt-2 text-sm font-bold text-moss">+{money(t.group_profit, cur)}</p>
            <p className="text-[0.7rem] text-text-muted">group profit</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Day-by-day itinerary — the researched plan ───────────────────────────────
function Itinerary({ report }: { report: TripReport }) {
  if (report.itinerary.length === 0) return null
  return (
    <div className="mt-8">
      <DocHeading>Your day-by-day plan</DocHeading>
      <ol className="mt-3 space-y-3">
        {report.itinerary.map((d) => (
          <li key={d.day} className="rounded-md border border-divider-strong bg-white p-4">
            <div className="flex items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-warm/15 text-xs font-bold text-warm">
                {d.day}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">{d.title}</p>
                {d.summary ? <p className="mt-1 text-xs leading-relaxed text-text-secondary">{d.summary}</p> : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {d.stay ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-stripe-strong px-2 py-0.5 text-[0.7rem] font-medium text-text-secondary">
                      🛏 {d.stay}
                    </span>
                  ) : null}
                  {d.activities.map((a) => (
                    <span key={a} className="inline-flex items-center gap-1 rounded-full bg-warm/10 px-2 py-0.5 text-[0.7rem] font-medium text-warm-ink">
                      ◆ {a}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ── Fill + ad plan (secondary) — the profit-max promo budget ─────────────────
function FillPlan({ report }: { report: TripReport }) {
  const p = report.plan
  const cur = p.currency
  if (!p.ads_worth_it) {
    return (
      <div className="mt-8 rounded-md border border-divider-strong bg-white p-5">
        <DocHeading>Filling the seats</DocHeading>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">{p.read}</p>
      </div>
    )
  }
  return (
    <div
      className="mt-8 overflow-hidden rounded-md p-6 text-white md:p-7"
      style={{ background: 'linear-gradient(135deg, var(--color-warm) 0%, var(--color-warm-hover) 100%)' }}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75">
        Fill the rest with promo
      </p>
      <p className="mt-2 font-display text-[clamp(1.5rem,4.5vw,2.2rem)] leading-tight">
        Spend <span className="whitespace-nowrap">{money(p.recommended_ad_budget, cur)}</span> →
        book <span className="whitespace-nowrap">~{p.ad_bookings_low}–{p.ad_bookings_high}</span> more
        seats → net <span className="whitespace-nowrap">≈{money(p.ad_extra_profit, cur)}</span>.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat k="Promo budget" v={money(p.recommended_ad_budget, cur)} sub="the profit sweet-spot" />
        <Stat k="Extra seats booked" v={`${p.ad_bookings_low}–${p.ad_bookings_high}`} sub={`~${money(p.ad_extra_profit, cur)} extra profit`} />
        <Stat k="Ad cost per click" v={money(p.cpc, cur)} sub={p.cpc_source === 'researched' ? 'from live research' : 'estimated'} />
      </div>
      <div className="mt-5 rounded-md bg-white/10 p-4 text-sm text-white/90">{p.read}</div>
    </div>
  )
}

// ── Pick your spend — the promo scenario ladder ──────────────────────────────
function ScenarioLadder({ scenarios, currency }: { scenarios: TripScenario[]; currency: string }) {
  if (scenarios.length === 0) return null
  const maxProfit = Math.max(...scenarios.map((s) => s.extra_profit), 1)
  return (
    <div className="mt-8">
      <DocHeading>Pick your promo spend</DocHeading>
      <p className="mt-1 text-sm text-text-secondary">
        Every level nets extra profit — pick your risk. We recommend the one marked ★.
      </p>
      <div className="mt-3 space-y-2">
        {scenarios.map((s) => (
          <div
            key={s.label}
            className={cn('rounded-md border p-3', s.recommended ? 'border-warm bg-warm/10' : 'border-divider-strong bg-white')}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-text-primary">
                {s.recommended ? '★ ' : ''}{s.label} — {money(s.budget, currency)}
              </span>
              <span className="text-xs text-text-secondary">
                {s.total_booked} booked ({s.pct_full}% full)
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-stripe">
                <div className="h-full rounded-full bg-warm" style={{ width: `${Math.max(4, (s.extra_profit / maxProfit) * 100)}%` }} />
              </div>
              <span className="shrink-0 text-sm font-bold text-warm-ink">+{money(s.extra_profit, currency)} profit</span>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {s.ad_bookings} extra seats{s.cost_per_booking !== null ? ` · ${money(s.cost_per_booking, currency)}/seat` : ''}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Weather card ─────────────────────────────────────────────────────────────
function weatherGlyph(summary: string): string {
  const s = summary.toLowerCase()
  if (/(snow|freezing)/.test(s)) return '❄️'
  if (/(thunder|storm)/.test(s)) return '⛈️'
  if (/(rain|drizzle|shower)/.test(s)) return '🌧️'
  if (/fog/.test(s)) return '🌫️'
  if (/(overcast|cloud)/.test(s)) return '☁️'
  if (/(clear|sun)/.test(s)) return '☀️'
  return '🌤️'
}
function WeatherCard({ weather }: { weather: NonNullable<TripReport['weather']> }) {
  const badge = weather.kind === 'forecast'
    ? { t: 'Forecast', c: 'bg-moss/15 text-moss' }
    : { t: weather.kind === 'climate_normal' ? 'Typical for these dates' : 'Seasonal', c: 'bg-butter/20 text-warning' }
  return (
    <div className="rounded-md border border-divider-strong bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <DocHeading>Weather</DocHeading>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold', badge.c)}>{badge.t}</span>
      </div>
      <div className="mt-2 flex items-start gap-3">
        <span aria-hidden="true" className="text-3xl leading-none">{weatherGlyph(weather.summary)}</span>
        <div>
          <p className="text-sm text-text-secondary">{weather.summary}</p>
          {weather.impact ? <p className="mt-1 text-xs font-medium text-warm-ink">{weather.impact}</p> : null}
        </div>
      </div>
    </div>
  )
}

export function TripReportView({
  report,
  runId,
  initialGated = true,
}: {
  report: TripReport
  runId: string
  initialGated?: boolean
}) {
  const [gated, setGated] = useState(initialGated)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [gateError, setGateError] = useState<GrowthToolsError | null>(null)
  const [emailedTo, setEmailedTo] = useState<string | null>(null)

  // Deep-link to /schedule with trip context (added after mount — no SSR window).
  const [bookHref, setBookHref] = useState(
    () => `/schedule?${new URLSearchParams({ venue: report.trip.title, source: 'trip_quoter' }).toString()}`,
  )
  useEffect(() => {
    setBookHref(
      `/schedule?${new URLSearchParams({
        venue: report.trip.title,
        source: 'trip_quoter',
        report_url: window.location.href,
      }).toString()}`,
    )
  }, [report.trip.title])

  useEffect(() => {
    captureMarketing('tool_gate_viewed', { tool: 'trips', run_id: runId })
  }, [runId])
  useEffect(() => {
    if (!gated) captureMarketing('tool_offer_view', { tool: 'trips', run_id: runId })
  }, [gated, runId])

  const emailValid = EMAIL_REGEX.test(email.trim())
  const t = report.trip
  const offerFrom = report.offer?.per_person_from ?? '$3.99'
  const durationLabel = `${t.nights} night${t.nights === 1 ? '' : 's'} · ${t.days} day${t.days === 1 ? '' : 's'}`

  async function onGateSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!emailValid || submitting) return
    setSubmitting(true)
    setGateError(null)
    captureMarketing('tool_gate_email_submitted', { tool: 'trips', run_id: runId })
    const res = await submitGrowthToolsGate(runId, email.trim())
    setSubmitting(false)
    if (res.ok) {
      captureMarketing('tool_report_emailed', { tool: 'trips', run_id: runId })
      setEmailedTo(email.trim())
      return
    }
    setGateError(res.error)
  }

  return (
    <article
      data-theme="light"
      className="rounded-md bg-parchment p-5 font-dashboard text-text-primary shadow-[0_40px_120px_rgba(0,0,0,0.5)] sm:p-8 md:p-10"
    >
      {/* ── FREE ZONE ─────────────────────────────────────────────────────── */}
      <header>
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-warm">
          {t.destination}
        </span>
        <h1 className="mt-2 break-words font-display text-3xl leading-tight text-text-primary md:text-4xl">
          {t.title}
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          {[t.departure ? `From ${t.departure}` : '', t.date_range, durationLabel, `${t.group_size} people`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      <div className="mt-6">
        <PriceHero report={report} />
      </div>

      {report.cover_narrative ? (
        <p className="mt-5 text-sm leading-relaxed text-text-secondary md:text-base">
          {report.cover_narrative}
        </p>
      ) : null}

      {/* ── GATED ZONE ────────────────────────────────────────────────────── */}
      <section className="relative mt-8">
        <div className={cn(gated && 'pointer-events-none select-none blur-[7px]')} aria-hidden={gated}>
          {/* Bottom line + cost sheet — decision-first */}
          <div className="grid gap-4">
            <DecisionBox report={report} />
            <CostSheet report={report} />
          </div>

          {/* What to charge — the margin ladder */}
          <MarginLadder plan={report.plan} />

          {/* Day-by-day itinerary */}
          <Itinerary report={report} />

          {/* Named hotels */}
          {report.hotels.length > 0 ? (
            <div className="mt-8">
              <DocHeading>Where they’ll stay</DocHeading>
              <ul className="mt-3 space-y-2">
                {report.hotels.map((h) => (
                  <li key={h.name} className="rounded-md border border-divider-strong bg-white p-3.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-text-primary">{h.name}</p>
                      {h.nightly_pp !== null ? (
                        <span className="rounded-full bg-stripe-strong px-2 py-0.5 text-[0.7rem] font-semibold text-text-muted">
                          ~{money(h.nightly_pp, report.plan.currency)}/night pp
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">
                      {[h.area, h.note].filter(Boolean).join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* What to charge vs market — comparable trips */}
          {report.comparables.length > 0 ? (
            <div className="mt-8 rounded-md border border-divider-strong bg-white p-4">
              <DocHeading>What comparable trips charge</DocHeading>
              <ul className="mt-2 space-y-2">
                {report.comparables.map((c) => (
                  <li key={c.name} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-semibold text-text-primary">{c.name}</span>
                      {c.operator ? <span className="text-text-muted"> · {c.operator}</span> : null}
                    </span>
                    {c.price_pp !== null ? (
                      <span className="shrink-0 font-bold text-text-primary tabular-nums">
                        {money(c.price_pp, report.plan.currency)}/person
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Fill + ad plan */}
          <FillPlan report={report} />

          {/* Scenario ladder — pick your promo spend */}
          {report.plan.ads_worth_it && report.plan.scenarios.length > 0 ? (
            <ScenarioLadder scenarios={report.plan.scenarios} currency={report.plan.currency} />
          ) : null}

          {/* Factor breakdown */}
          {report.factors.length > 0 ? (
            <div className="mt-8">
              <DocHeading>What’s shaping this quote</DocHeading>
              <div className="mt-3 grid gap-2.5 sm:auto-rows-fr sm:grid-cols-2">
                {report.factors.map((factor, i) => {
                  const s = FACTOR_STYLE[factor.status]
                  const lastOdd = i === report.factors.length - 1 && report.factors.length % 2 === 1
                  return (
                    <div key={factor.label} className={cn('rounded-md border border-divider-strong bg-white p-3.5', lastOdd && 'sm:col-span-2')}>
                      <div className="flex items-center gap-2">
                        <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border text-xs font-bold', s.className)}>
                          {s.mark}
                        </span>
                        <p className="text-sm font-semibold text-text-primary">{factor.label}</p>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">{factor.detail}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {/* Weather + demand — side by side */}
          {(report.weather || report.demand_read) ? (
            <div className="mt-8 grid gap-4 md:auto-rows-fr md:grid-cols-2">
              {report.weather ? <WeatherCard weather={report.weather} /> : null}
              {report.demand_read ? (
                <div className="rounded-md border border-divider-strong bg-white p-4">
                  <DocHeading>Demand right now</DocHeading>
                  <p className="mt-2 text-sm text-text-secondary">{report.demand_read}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Fixes */}
          {report.fixes.length > 0 ? (
            <div className="mt-8">
              <DocHeading>How to sell it out & lift margin</DocHeading>
              <ol className="mt-3 space-y-3">
                {report.fixes.map((fix, i) => (
                  <li key={fix.title} className="rounded-md border border-divider-strong bg-white p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-warm/15 text-xs font-bold text-warm">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-text-primary">{fix.title}</p>
                          <span className="rounded-full border border-divider-strong bg-stripe-strong px-2 py-0.5 text-[0.7rem] font-medium text-text-secondary">
                            {EFFORT_CHIP[fix.effort] ?? fix.effort}
                          </span>
                        </div>
                        {fix.change ? <p className="mt-1 text-xs leading-relaxed text-text-secondary">{fix.change}</p> : null}
                        {fix.lift_note ? <p className="mt-1 text-xs font-semibold text-warm-ink">Upside: {fix.lift_note}</p> : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {/* Listing preview link */}
          <div className="mt-8 rounded-md border border-divider-strong bg-white p-5">
            <DocHeading>Your trip as a bookable Mingla page</DocHeading>
            <p className="mt-2 text-sm text-text-secondary">
              {report.listing_preview.tagline || 'A polished, ready-to-publish version of this trip.'}
            </p>
            {report.listing_preview.vibe_tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {report.listing_preview.vibe_tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-warm/10 px-3 py-1 text-xs font-semibold text-warm-ink">{tag}</span>
                ))}
              </div>
            ) : null}
            {!gated ? (
              <Link
                href={`/trip-preview?run_id=${encodeURIComponent(runId)}`}
                target="_blank"
                className="mt-4 inline-flex min-h-10 items-center rounded-full border border-divider-strong bg-parchment px-4 text-sm font-semibold text-text-primary transition hover:bg-stripe focus-ring"
              >
                See the full trip page preview →
              </Link>
            ) : null}
          </div>
        </div>

        {/* Gate overlay */}
        {gated ? (
          <div className="absolute inset-x-0 top-0 z-10 flex justify-center px-2 pt-10">
            <div className="w-full max-w-md rounded-md border border-divider-strong bg-parchment p-6 text-center shadow-[0_24px_64px_rgba(0,0,0,0.25)]">
              {emailedTo ? (
                <>
                  <div className="mx-auto grid size-11 place-items-center rounded-full bg-moss/15 text-xl text-moss">✓</div>
                  <p className="mt-3 font-display text-xl text-text-primary">Check your inbox</p>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    Your full costed quote — cost sheet, itinerary and a client-ready proposal — is on
                    its way to <span className="font-semibold text-text-primary">{emailedTo}</span> with
                    a private link.
                  </p>
                  <button
                    type="button"
                    onClick={() => setEmailedTo(null)}
                    className="mt-3 text-sm font-semibold text-warm underline-offset-4 hover:underline focus-ring"
                  >
                    Wrong email? Send to a different one
                  </button>
                </>
              ) : (
                <>
                  <p className="font-display text-xl text-text-primary">See your full quote</p>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    The cost sheet, the day-by-day plan, what to charge, and a client-ready proposal —
                    we’ll email your full quote with a private link.
                  </p>
                  <form onSubmit={onGateSubmit} className="mt-4">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@yourtravelco.com"
                        aria-label="Your email"
                        aria-invalid={email.trim().length > 0 && !emailValid}
                        className="min-h-11 w-full min-w-0 flex-1 rounded-sm border border-divider-strong bg-white px-3 text-base text-text-primary placeholder:text-text-muted focus-ring"
                      />
                      <button
                        type="submit"
                        disabled={!emailValid || submitting}
                        className={buttonClasses({ variant: 'primary', size: 'sm', className: 'whitespace-nowrap' })}
                      >
                        {submitting ? 'Sending…' : 'Email my quote'}
                      </button>
                    </div>
                    {gateError ? (
                      <p role="alert" className="mt-2 text-sm text-danger">{GATE_ERROR_COPY[gateError]}</p>
                    ) : null}
                  </form>
                </>
              )}
            </div>
          </div>
        ) : null}
      </section>

      {/* ── THE OFFER — one consolidated close (post-unlock) ────────────────── */}
      {!gated ? (
        <div
          className="mt-10 overflow-hidden rounded-md p-6 text-white md:p-8"
          style={{ background: 'linear-gradient(135deg, var(--color-warm) 0%, var(--color-warm-hover) 100%)' }}
        >
          <p className="break-words font-display text-[clamp(1.6rem,4.5vw,2.3rem)] leading-tight">
            You’ve got the quote. Now give them a real place to pay.
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/90 md:text-base">
            Publish this as a bookable Mingla trip page — checkout, deposits and pay-over-time built
            in — and we’ll fill the seats for as low as{' '}
            <span className="whitespace-nowrap">{offerFrom}</span> per head. Book a call and we’ll set it up.
          </p>
          <div className="mt-6">
            <Link
              href={bookHref}
              onClick={() => captureMarketing('tool_offer_cta_click', { tool: 'trips', run_id: runId, cta: 'call' })}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-white px-7 text-sm font-semibold text-warm-ink transition hover:bg-white/90 focus-ring"
            >
              Book a call — we’ll help you publish it
            </Link>
          </div>
        </div>
      ) : null}
    </article>
  )
}
