'use client'
// #1006 [The Undercharging Audit] — the report document.
//
// A parchment "document card" on the dark /tools stage (data-theme="light").
// FREE zone: the experience header + the STINGING NUMBER (you lost £X / left £X
// on the table) with the arithmetic shown. GATED zone (blur + gate overlay):
// the true cost-per-head sheet (incl. their own time), the recommended price +
// break-even + upside, comparable experiences, factors and fixes — revealed only
// via the emailed tokenized link. Once ungated the offer closes to /schedule.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/cn'
import { buttonClasses } from '@/components/ui/button'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import {
  submitGrowthToolsGate,
  type PricingFactor,
  type PricingReport,
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

const FACTOR_STYLE: Record<PricingFactor['status'], { mark: string; className: string }> = {
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

function EstimateNote({ checkedOn, note }: { checkedOn?: string; note?: string }) {
  return (
    <p className="mt-3 text-xs leading-relaxed text-text-muted">
      {note || 'Comps are current estimates from live research; your loss/upside is your own maths.'}
      {checkedOn ? ` Checked ${checkedOn}.` : ''}
    </p>
  )
}

// ── The stinging number + the arithmetic (free preview) ──────────────────────
function StingHero({ report }: { report: PricingReport }) {
  const a = report.audit
  const cur = a.currency
  const tone = a.verdict === 'losing'
    ? { label: 'You’re losing money', amount: 'bg-danger/10 text-danger', border: 'border-danger/30' }
    : a.verdict === 'underpriced'
      ? { label: 'You’re leaving money on the table', amount: 'bg-warm/10 text-warm-ink', border: 'border-warm/30' }
      : { label: 'You’re priced about right', amount: 'bg-moss/10 text-moss', border: 'border-moss/30' }
  const big = a.verdict === 'healthy'
    ? money(a.recommended_price, cur)
    : money(a.headline_amount, cur)
  return (
    <div className={cn('rounded-md border bg-stripe p-6 text-center md:p-8', tone.border)}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">{tone.label}</p>
      <p className="mt-2 font-display text-[clamp(2.4rem,8vw,4rem)] leading-none text-text-primary">
        {a.verdict === 'healthy' ? '' : a.verdict === 'losing' ? '−' : '+'}{big}
        {a.verdict !== 'healthy' ? <span className="align-middle text-base font-semibold text-text-muted"> /mo</span> : null}
      </p>
      {a.verdict !== 'healthy' ? (
        <p className="mt-1 text-sm font-semibold text-text-secondary">
          {a.verdict === 'losing' ? 'lost every month, once your time is counted' : 'left on the table every month'}
        </p>
      ) : (
        <p className="mt-1 text-sm font-semibold text-text-secondary">the price your costs and market support</p>
      )}
      {/* the arithmetic, worked */}
      <div className="mx-auto mt-5 max-w-md rounded-md bg-white p-3 text-left">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-text-muted">The maths</p>
        <p className="mt-1 text-sm text-text-secondary">
          {money(a.current_price, cur)} × {a.seats} seats ={' '}
          <span className="font-semibold text-text-primary">{money(a.revenue_per_event, cur)}</span> in
          {' '}−{' '}
          <span className="font-semibold text-text-primary">{money(a.total_cost_per_event, cur)}</span> true cost
          {' '}={' '}
          <span className={cn('font-bold', a.profit_per_event < 0 ? 'text-danger' : 'text-moss')}>
            {money(a.profit_per_event, cur)}
          </span>{' '}
          / event × {a.events_per_month} a month.
        </p>
      </div>
      {report.headline_verdict ? (
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-text-secondary md:text-base">
          {report.headline_verdict}
        </p>
      ) : null}
    </div>
  )
}

// ── True cost per head — including their own time ────────────────────────────
function CostSheet({ report }: { report: PricingReport }) {
  const a = report.audit
  const cur = a.currency
  return (
    <div className="rounded-md border border-divider-strong bg-white p-5">
      <DocHeading>Your true cost per head</DocHeading>
      <p className="mt-1 text-sm text-text-secondary">
        Most hosts never count their own time. Here it is, in the number.
      </p>
      <div className="mt-3 divide-y divide-divider">
        {a.cost_lines.map((line) => (
          <div key={line.key} className="flex items-baseline justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary">
                {line.label}
                {line.key === 'time' ? <span className="ml-2 rounded-full bg-warm/15 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-warm-ink">often forgotten</span> : null}
                {line.estimated ? <span className="ml-2 text-[0.65rem] font-medium text-text-muted">(estimated)</span> : null}
              </p>
              {line.basis ? <p className="text-xs text-text-muted">{line.basis}</p> : null}
            </div>
            <p className="shrink-0 text-sm font-bold text-text-primary tabular-nums">
              {money(line.per_head, cur)}<span className="text-xs font-normal text-text-muted">/head</span>
            </p>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 py-2.5">
          <p className="text-sm font-bold text-text-primary">True cost per head</p>
          <p className="shrink-0 text-base font-bold text-text-primary tabular-nums">{money(a.cost_per_head, cur)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-stripe-strong px-3 py-2 text-xs text-text-secondary">
        <span>You charge <span className="font-bold text-text-primary">{a.current_price > 0 ? money(a.current_price, cur) : 'nothing'}</span></span>
        <span>Margin per head: <span className={cn('font-bold', a.margin_per_head < 0 ? 'text-danger' : 'text-moss')}>{money(a.margin_per_head, cur)}</span></span>
        {a.break_even_seats_now !== null ? (
          <span>Break-even: <span className="font-bold text-text-primary">{a.break_even_seats_now} seats</span></span>
        ) : null}
      </div>
      <EstimateNote checkedOn={report.price_basis?.checked_on} note={report.price_basis?.note} />
    </div>
  )
}

// ── The price you should charge ──────────────────────────────────────────────
function RecommendedPrice({ report }: { report: PricingReport }) {
  const a = report.audit
  const cur = a.currency
  const higher = a.recommended_price > a.current_price
  return (
    <div
      className="mt-8 overflow-hidden rounded-md p-6 text-white md:p-7"
      style={{ background: 'linear-gradient(135deg, var(--color-warm) 0%, var(--color-warm-hover) 100%)' }}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75">The price you should charge</p>
      <p className="mt-2 font-display text-[clamp(1.8rem,5vw,2.6rem)] leading-tight">
        {money(a.recommended_price, cur)} <span className="text-lg font-semibold text-white/80">per person</span>
      </p>
      {higher ? (
        <p className="mt-1 text-sm text-white/90">
          Up from {money(a.current_price, cur)} — about {money(a.extra_per_head, cur)} more a head.
        </p>
      ) : null}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-md bg-white/12 p-3">
          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-white/70">Margin per head</p>
          <p className="mt-1 text-lg font-bold">{a.recommended_margin_pct}%</p>
        </div>
        <div className="rounded-md bg-white/12 p-3">
          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-white/70">Break-even seats</p>
          <p className="mt-1 text-lg font-bold">{a.break_even_seats_rec ?? '—'}<span className="text-xs font-normal text-white/70"> of {a.seats}</span></p>
        </div>
        <div className="rounded-md bg-white/12 p-3">
          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-white/70">{a.verdict === 'losing' ? 'Swing to profit' : 'Extra per month'}</p>
          <p className="mt-1 text-lg font-bold">{money(a.monthly_upside, cur)}</p>
        </div>
      </div>
      {report.premium_framing ? (
        <div className="mt-5 rounded-md bg-white/10 p-4 text-sm leading-relaxed text-white/90">
          {report.premium_framing}
        </div>
      ) : null}
      {report.value_points.length > 0 ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {report.value_points.map((v) => (
            <li key={v} className="flex items-start gap-2 text-sm text-white/90">
              <span aria-hidden="true" className="mt-0.5 text-white">◆</span>
              <span>{v}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

// ── Weather-card-style verdict decision box ──────────────────────────────────
function DecisionBox({ report }: { report: PricingReport }) {
  const a = report.audit
  const topFix = report.fixes[0]
  const risk = report.factors.find((x) => x.status === 'hurt') ??
    report.factors.find((x) => x.status === 'watch')
  return (
    <div className="rounded-md border-2 border-warm/30 bg-warm/[0.06] p-5 md:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-warm">The bottom line</p>
      <p className="mt-2 text-base leading-relaxed text-text-primary md:text-lg">{a.read}</p>
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

export function PricingReportView({
  report,
  runId,
  initialGated = true,
}: {
  report: PricingReport
  runId: string
  initialGated?: boolean
}) {
  const [gated, setGated] = useState(initialGated)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [gateError, setGateError] = useState<GrowthToolsError | null>(null)
  const [emailedTo, setEmailedTo] = useState<string | null>(null)

  const shortTitle = report.experience.description.length > 60
    ? `${report.experience.description.slice(0, 57)}…`
    : report.experience.description

  const [bookHref, setBookHref] = useState(
    () => `/schedule?${new URLSearchParams({ venue: shortTitle, source: 'pricing_audit' }).toString()}`,
  )
  useEffect(() => {
    setBookHref(
      `/schedule?${new URLSearchParams({
        venue: shortTitle,
        source: 'pricing_audit',
        report_url: window.location.href,
      }).toString()}`,
    )
  }, [shortTitle])

  useEffect(() => {
    captureMarketing('tool_gate_viewed', { tool: 'experiences', run_id: runId })
  }, [runId])
  useEffect(() => {
    if (!gated) captureMarketing('tool_offer_view', { tool: 'experiences', run_id: runId })
  }, [gated, runId])

  const emailValid = EMAIL_REGEX.test(email.trim())
  const e = report.experience
  const cur = report.audit.currency

  async function onGateSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!emailValid || submitting) return
    setSubmitting(true)
    setGateError(null)
    captureMarketing('tool_gate_email_submitted', { tool: 'experiences', run_id: runId })
    const res = await submitGrowthToolsGate(runId, email.trim())
    setSubmitting(false)
    if (res.ok) {
      captureMarketing('tool_report_emailed', { tool: 'experiences', run_id: runId })
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
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-warm">{e.category}</span>
        <h1 className="mt-2 break-words font-display text-2xl leading-tight text-text-primary md:text-3xl">
          {shortTitle}
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          {[e.city, `${e.seats} seats`, e.current_price > 0 ? `${money(e.current_price, cur)}/person` : 'Currently free', `${e.events_per_month}×/month`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      <div className="mt-6">
        <StingHero report={report} />
      </div>

      {report.narrative ? (
        <p className="mt-5 text-sm leading-relaxed text-text-secondary md:text-base">{report.narrative}</p>
      ) : null}

      {/* ── GATED ZONE ────────────────────────────────────────────────────── */}
      <section className="relative mt-8">
        <div className={cn(gated && 'pointer-events-none select-none blur-[7px]')} aria-hidden={gated}>
          <div className="grid gap-4">
            <DecisionBox report={report} />
            <CostSheet report={report} />
          </div>

          {/* The price you should charge */}
          <RecommendedPrice report={report} />

          {/* Comparable experiences */}
          {report.comps.length > 0 ? (
            <div className="mt-8 rounded-md border border-divider-strong bg-white p-4">
              <DocHeading>What comparable experiences charge</DocHeading>
              <ul className="mt-2 space-y-2">
                {report.comps.map((c) => (
                  <li key={c.name} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-semibold text-text-primary">{c.name}</span>
                      {c.note ? <span className="text-text-muted"> — {c.note}</span> : null}
                    </span>
                    {c.price_pp !== null ? (
                      <span className="shrink-0 font-bold text-text-primary tabular-nums">{money(c.price_pp, cur)}/pp</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Factor breakdown */}
          {report.factors.length > 0 ? (
            <div className="mt-8">
              <DocHeading>What’s shaping your price</DocHeading>
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

          {/* Demand */}
          {report.demand_read ? (
            <div className="mt-8 rounded-md border border-divider-strong bg-white p-4">
              <DocHeading>Demand right now</DocHeading>
              <p className="mt-2 text-sm text-text-secondary">{report.demand_read}</p>
            </div>
          ) : null}

          {/* Fixes */}
          {report.fixes.length > 0 ? (
            <div className="mt-8">
              <DocHeading>How to reprice without losing bookings</DocHeading>
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
                    Your full audit — true cost per head, the price to charge, and the comps — is on
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
                  <p className="font-display text-xl text-text-primary">See your full audit</p>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    Your true cost per head, the price you should charge, the comps and how to
                    reprice — we’ll email your full audit with a private link.
                  </p>
                  <form onSubmit={onGateSubmit} className="mt-4">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={email}
                        onChange={(ev) => setEmail(ev.target.value)}
                        placeholder="you@yourexperience.com"
                        aria-label="Your email"
                        aria-invalid={email.trim().length > 0 && !emailValid}
                        className="min-h-11 w-full min-w-0 flex-1 rounded-sm border border-divider-strong bg-white px-3 text-base text-text-primary placeholder:text-text-muted focus-ring"
                      />
                      <button
                        type="submit"
                        disabled={!emailValid || submitting}
                        className={buttonClasses({ variant: 'primary', size: 'sm', className: 'whitespace-nowrap' })}
                      >
                        {submitting ? 'Sending…' : 'Email my audit'}
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
            Relaunch at the right price — all-in checkout, no surprise fees.
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/90 md:text-base">
            List your experience on Mingla at {money(report.audit.recommended_price, cur)}, take
            bookings with all-in pricing, and we’ll help fill the seats for as low as{' '}
            <span className="whitespace-nowrap">{report.offer?.per_person_from ?? '$3.99'}</span> per head.
            Book a call and we’ll set it up.
          </p>
          <div className="mt-6">
            <Link
              href={bookHref}
              onClick={() => captureMarketing('tool_offer_cta_click', { tool: 'experiences', run_id: runId, cta: 'call' })}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-white px-7 text-sm font-semibold text-warm-ink transition hover:bg-white/90 focus-ring"
            >
              Book a call — we’ll help you relaunch
            </Link>
          </div>
        </div>
      ) : null}
    </article>
  )
}
