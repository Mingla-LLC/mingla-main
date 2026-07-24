'use client'
// #1004 [Event Turnout Predictor] — the report document.
//
// A parchment "document card" on the dark /tools stage (data-theme="light").
// FREE zone: the event header + the big turnout FORECAST (range, % of capacity,
// confidence) + headline. GATED zone (blur + gate overlay): the budget engine
// (what your promo spend buys), the factor breakdown, competing events,
// comparables, weather, and the fixes — revealed only via the emailed tokenized
// link (entering an email sends a summary, it does NOT unlock the page). Once
// ungated (from that link) the consolidated offer card closes to /schedule.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/cn'
import { buttonClasses } from '@/components/ui/button'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import {
  submitGrowthToolsGate,
  type EventFactor,
  type EventReport,
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

const FACTOR_STYLE: Record<EventFactor['status'], { mark: string; className: string; word: string }> = {
  help: { mark: '↑', className: 'border-moss/40 bg-moss/12 text-moss', word: 'Helps' },
  watch: { mark: '~', className: 'border-butter/50 bg-butter/15 text-warning', word: 'Watch' },
  hurt: { mark: '↓', className: 'border-danger/30 bg-danger/10 text-danger', word: 'Hurts' },
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

function dateLabel(iso: string, time: string): string {
  const ms = Date.parse(`${iso}T00:00:00Z`)
  if (!Number.isFinite(ms)) return iso
  const d = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(ms))
  return time ? `${d} · ${time}` : d
}

function DocHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
      {children}
    </h2>
  )
}

// ── Forecast hero: the turnout range + capacity bar + confidence ─────────────
function ForecastHero({ report }: { report: EventReport }) {
  const f = report.forecast
  const cap = Math.max(1, f.capacity)
  const lowPct = Math.min(100, Math.round((f.total_low / cap) * 100))
  const highPct = Math.min(100, Math.round((f.total_high / cap) * 100))
  const confColor = f.confidence === 'high'
    ? 'bg-moss/15 text-moss'
    : f.confidence === 'low'
      ? 'bg-danger/10 text-danger'
      : 'bg-butter/20 text-warning'
  return (
    <div className="rounded-md border border-divider-strong bg-stripe p-6 text-center md:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
        Predicted turnout
      </p>
      <p className="mt-2 font-display text-[clamp(2.6rem,9vw,4.5rem)] leading-none text-text-primary">
        {f.total_low}<span className="text-text-muted">–</span>{f.total_high}
      </p>
      <p className="mt-1 text-sm font-semibold text-text-secondary">
        {f.pct_capacity_low}–{f.pct_capacity_high}% of your {f.capacity} capacity
      </p>
      {/* capacity bar */}
      <div className="mx-auto mt-5 h-2.5 max-w-md overflow-hidden rounded-full bg-divider-strong">
        <div
          className="h-full rounded-full bg-warm/40"
          style={{ width: `${highPct}%` }}
        >
          <div className="h-full rounded-full bg-warm" style={{ width: `${lowPct === 0 ? 0 : (lowPct / Math.max(highPct, 1)) * 100}%` }} />
        </div>
      </div>
      <div className="mt-4 inline-flex items-center gap-2">
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize', confColor)}>
          {f.confidence} confidence
        </span>
      </div>
      {f.headline_read ? (
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-text-secondary md:text-base">
          {f.headline_read}
        </p>
      ) : null}
    </div>
  )
}

// Small stat cell used across both plan cards.
function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="rounded-md bg-white/12 p-3">
      <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-white/70">{k}</p>
      <p className="mt-1 text-lg font-bold">{v}</p>
      {sub ? <p className="text-[0.7rem] text-white/70">{sub}</p> : null}
    </div>
  )
}

function BenchmarkNote({ lines }: { lines: string[] }) {
  return (
    <p className="mt-3 text-xs leading-relaxed text-white/70">
      Based on industry benchmarks ({lines.join(' · ')}), refined by live research on your event.
      Estimates for planning — real results vary.
    </p>
  )
}

// ── The plan engine: profit-optimiser (paid) or budget-buys (free) ───────────
function BudgetEngine({ report }: { report: EventReport }) {
  // Reports generated before #1100 stored `paid_plan`, not `plan` — guard so an
  // old emailed link degrades gracefully instead of throwing a client exception.
  const plan = report.plan as EventReport['plan'] | undefined
  const offerFrom = report.offer?.per_person_from ?? '$3.99'
  if (!plan || (plan.kind !== 'paid_optimized' && plan.kind !== 'free_budget')) {
    return (
      <div className="rounded-md border border-divider-strong bg-white p-5">
        <DocHeading>Your ad-spend plan</DocHeading>
        <p className="mt-3 text-sm leading-relaxed text-text-secondary">
          This report predates our upgraded ad-spend planner. Re-run the predictor for the
          full profit-max forecast — Mingla can drive people to your event from{' '}
          <span className="font-semibold text-text-primary">{offerFrom}</span> per head.
        </p>
      </div>
    )
  }
  const cur = plan.currency
  const warmCard =
    'overflow-hidden rounded-md p-6 text-white md:p-7'
  const warmStyle = {
    background: 'linear-gradient(135deg, var(--color-warm) 0%, var(--color-warm-hover) 100%)',
  }

  // ── PAID: recommend the profit-max budget ─────────────────────────────────
  if (plan.kind === 'paid_optimized') {
    if (!plan.ads_worth_it) {
      return (
        <div className="rounded-md border border-divider-strong bg-white p-5">
          <DocHeading>Your ad-spend plan</DocHeading>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">{plan.read}</p>
          <p className="mt-2 text-xs text-text-muted">
            (At {money(plan.ticket_price, cur)}/ticket, ad clicks cost about {money(plan.cpc, cur)}{' '}
            and ~{plan.benchmarks.landing_to_ticket_pct}% buy — so each ad ticket would cost more
            than it earns. Lean on organic + Mingla’s {offerFrom}/head promotion.)
          </p>
        </div>
      )
    }
    return (
      <div className={warmCard} style={warmStyle}>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75">
          Your profit-max ad plan
        </p>
        <p className="mt-2 font-display text-[clamp(1.5rem,4.5vw,2.2rem)] leading-tight">
          Spend <span className="whitespace-nowrap">{money(plan.recommended_budget, cur)}</span> on ads
          → net <span className="whitespace-nowrap">≈{money(plan.ad_profit, cur)}</span> more profit.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat k="Recommended budget" v={money(plan.recommended_budget, cur)} sub="the profit sweet-spot" />
          <Stat k="Extra tickets sold" v={`${plan.ad_tickets_low}–${plan.ad_tickets_high}`} sub={`~${money(plan.ad_revenue, cur)} revenue`} />
          <Stat k="Cost per ticket" v={plan.cost_per_ticket !== null ? money(plan.cost_per_ticket, cur) : '—'} sub={plan.cost_pct_of_ticket !== null ? `${plan.cost_pct_of_ticket}% of your ticket` : undefined} />
          <Stat k="Return on ad spend" v={plan.roas !== null ? `${plan.roas}×` : '—'} sub="revenue per £/$ spent" />
        </div>
        <div className="mt-5 rounded-md bg-white/10 p-4 text-sm text-white/90">
          {plan.read} Beyond that, each new ticket starts costing more than it earns.
        </div>
        <BenchmarkNote
          lines={[
            `ad CPC ${money(plan.cpc, cur)}`,
            `${plan.benchmarks.landing_to_ticket_pct}% buy`,
            `${plan.benchmarks.show_rate_pct}% show up`,
          ]}
        />
      </div>
    )
  }

  // ── FREE: what the budget buys ────────────────────────────────────────────
  if (!plan.budget || plan.budget <= 0) {
    return (
      <div className="rounded-md border border-divider-strong bg-white p-5">
        <DocHeading>What a promo budget could add</DocHeading>
        <p className="mt-3 text-sm leading-relaxed text-text-secondary">
          This is your organic outlook. Add a promo budget on a re-run and we’ll show exactly
          how many more people it can bring — Mingla puts your event in front of people already
          planning their week, from{' '}
          <span className="font-semibold text-text-primary">{offerFrom}</span> per head.
        </p>
      </div>
    )
  }
  return (
    <div className={warmCard} style={warmStyle}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75">
        Your {money(plan.budget, cur)} promo plan
      </p>
      <p className="mt-2 font-display text-[clamp(1.5rem,4.5vw,2.2rem)] leading-tight">
        Mingla can drive{' '}
        <span className="whitespace-nowrap">{plan.attendees_low}–{plan.attendees_high}</span>{' '}
        more people to your event.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat k="Ad cost per click" v={money(plan.cpc, cur)} sub={plan.cpc_source === 'researched' ? 'from live research' : 'estimated'} />
        <Stat k="Clicks your budget buys" v={`${plan.clicks_low}–${plan.clicks_high}`} sub="to your event page" />
        <Stat k="Cost per attendee" v={plan.cost_per_attendee_low !== null && plan.cost_per_attendee_high !== null ? `${money(plan.cost_per_attendee_low, cur)}–${money(plan.cost_per_attendee_high, cur)}` : '—'} sub={`promo from ${offerFrom}/head`} />
      </div>
      <BenchmarkNote
        lines={[
          `ad CPC ${money(plan.cpc, cur)}`,
          `${plan.benchmarks.landing_to_rsvp_pct}% RSVP`,
          `${plan.benchmarks.show_rate_pct}% show up`,
        ]}
      />
    </div>
  )
}

export function EventReportView({
  report,
  runId,
  initialGated = true,
}: {
  report: EventReport
  runId: string
  initialGated?: boolean
}) {
  const [gated, setGated] = useState(initialGated)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [gateError, setGateError] = useState<GrowthToolsError | null>(null)
  const [emailedTo, setEmailedTo] = useState<string | null>(null)

  // Deep-link to /schedule with event context (added after mount — no SSR window).
  const [bookHref, setBookHref] = useState(
    () => `/schedule?${new URLSearchParams({ venue: report.event.title, source: 'event_predictor' }).toString()}`,
  )
  useEffect(() => {
    setBookHref(
      `/schedule?${new URLSearchParams({
        venue: report.event.title,
        source: 'event_predictor',
        report_url: window.location.href,
      }).toString()}`,
    )
  }, [report.event.title])

  useEffect(() => {
    captureMarketing('tool_gate_viewed', { tool: 'events', run_id: runId })
  }, [runId])
  useEffect(() => {
    if (!gated) captureMarketing('tool_offer_view', { tool: 'events', run_id: runId })
  }, [gated, runId])

  const emailValid = EMAIL_REGEX.test(email.trim())
  const ev = report.event
  const offerFrom = report.offer?.per_person_from ?? '$3.99'

  async function onGateSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!emailValid || submitting) return
    setSubmitting(true)
    setGateError(null)
    captureMarketing('tool_gate_email_submitted', { tool: 'events', run_id: runId })
    const res = await submitGrowthToolsGate(runId, email.trim())
    setSubmitting(false)
    if (res.ok) {
      captureMarketing('tool_report_emailed', { tool: 'events', run_id: runId })
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
          {ev.category}
        </span>
        <h1 className="mt-2 break-words font-display text-3xl leading-tight text-text-primary md:text-4xl">
          {ev.title}
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          {[ev.venue_name, ev.city].filter(Boolean).join(' · ')} — {dateLabel(ev.date, ev.start_time)}
        </p>
      </header>

      <div className="mt-6">
        <ForecastHero report={report} />
      </div>

      {report.narrative ? (
        <p className="mt-5 text-sm leading-relaxed text-text-secondary md:text-base">
          {report.narrative}
        </p>
      ) : null}

      {/* ── GATED ZONE ────────────────────────────────────────────────────── */}
      <section className="relative mt-8">
        <div className={cn(gated && 'pointer-events-none select-none blur-[7px]')} aria-hidden={gated}>
          {/* Budget engine */}
          <div className="mt-2">
            <BudgetEngine report={report} />
          </div>

          {/* Factor breakdown */}
          {report.factors.length > 0 ? (
            <div className="mt-8">
              <DocHeading>What’s driving your turnout</DocHeading>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {report.factors.map((factor) => {
                  const s = FACTOR_STYLE[factor.status]
                  return (
                    <div key={factor.label} className="rounded-md border border-divider-strong bg-white p-3.5">
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

          {/* Competing events */}
          {report.competitors.length > 0 ? (
            <div className="mt-8">
              <DocHeading>Who you’re up against that night</DocHeading>
              <ul className="mt-3 space-y-2">
                {report.competitors.map((c) => (
                  <li key={c.name} className="rounded-md border border-divider-strong bg-white p-3.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-text-primary">{c.name}</p>
                      {c.platform ? <span className="rounded-full bg-stripe-strong px-2 py-0.5 text-[0.7rem] font-semibold text-text-muted">{c.platform}</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">
                      {[c.date_note, c.scale_note].filter(Boolean).join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Comparables + weather + demand */}
          {(report.comparables.length > 0 || report.weather || report.demand_read) ? (
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {report.comparables.length > 0 ? (
                <div className="rounded-md border border-divider-strong bg-white p-4">
                  <DocHeading>Similar events, real turnouts</DocHeading>
                  <ul className="mt-2 space-y-2">
                    {report.comparables.map((c) => (
                      <li key={c.name} className="text-sm">
                        <span className="font-semibold text-text-primary">{c.name}</span>
                        <span className="text-text-secondary"> — {c.turnout_note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="space-y-4">
                {report.weather ? (
                  <div className="rounded-md border border-divider-strong bg-white p-4">
                    <DocHeading>Weather {report.weather.kind === 'forecast' ? '(forecast)' : '(seasonal)'}</DocHeading>
                    <p className="mt-2 text-sm text-text-secondary">{report.weather.summary}</p>
                    {report.weather.impact ? <p className="mt-1 text-xs text-text-muted">{report.weather.impact}</p> : null}
                  </div>
                ) : null}
                {report.demand_read ? (
                  <div className="rounded-md border border-divider-strong bg-white p-4">
                    <DocHeading>Demand right now</DocHeading>
                    <p className="mt-2 text-sm text-text-secondary">{report.demand_read}</p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Fixes */}
          {report.fixes.length > 0 ? (
            <div className="mt-8">
              <DocHeading>How to pull a bigger crowd</DocHeading>
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
            <DocHeading>Your event as a Mingla listing</DocHeading>
            <p className="mt-2 text-sm text-text-secondary">
              {report.listing_preview.tagline || 'A polished, ready-to-publish version of your event.'}
            </p>
            {report.listing_preview.vibe_tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {report.listing_preview.vibe_tags.map((t) => (
                  <span key={t} className="rounded-full bg-warm/10 px-3 py-1 text-xs font-semibold text-warm-ink">{t}</span>
                ))}
              </div>
            ) : null}
            {!gated ? (
              <Link
                href={`/event-preview?run_id=${encodeURIComponent(runId)}`}
                target="_blank"
                className="mt-4 inline-flex min-h-10 items-center rounded-full border border-divider-strong bg-parchment px-4 text-sm font-semibold text-text-primary transition hover:bg-stripe focus-ring"
              >
                See the full listing preview →
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
                    Your full forecast — budget plan, competitors, weather and fixes — is on its
                    way to <span className="font-semibold text-text-primary">{emailedTo}</span> with
                    a private link.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-display text-xl text-text-primary">See your full forecast</p>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    Your budget plan, the competition, weather, and the fixes — we’ll email your
                    full report with a private link.
                  </p>
                  <form onSubmit={onGateSubmit} className="mt-4">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@yourevent.com"
                        aria-label="Your email"
                        aria-invalid={email.trim().length > 0 && !emailValid}
                        className="min-h-11 w-full min-w-0 flex-1 rounded-sm border border-divider-strong bg-white px-3 text-base text-text-primary placeholder:text-text-muted focus-ring"
                      />
                      <button
                        type="submit"
                        disabled={!emailValid || submitting}
                        className={buttonClasses({ variant: 'primary', size: 'sm', className: 'whitespace-nowrap' })}
                      >
                        {submitting ? 'Sending…' : 'Email my report'}
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
            We put your event in front of people planning their week — for as low as{' '}
            <span className="whitespace-nowrap">{offerFrom}</span> per head.
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/90 md:text-base">
            That’s the introductory Mingla promotion. Book a call and we’ll help you hit the
            top of your forecast — and list your event free.
          </p>
          <div className="mt-6">
            <Link
              href={bookHref}
              onClick={() => captureMarketing('tool_offer_cta_click', { tool: 'events', run_id: runId, cta: 'call' })}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-white px-7 text-sm font-semibold text-warm-ink transition hover:bg-white/90 focus-ring"
            >
              Book a call — we’ll help you fill it
            </Link>
          </div>
        </div>
      ) : null}
    </article>
  )
}
