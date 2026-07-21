'use client'
// #1003 [Venue Website Grader — growth tools, test cut] — the report document.
//
// A parchment "document card" (light card on the dark /tools stage —
// data-theme="light" flips the theme-aware text tokens; Inter via
// .font-dashboard; radius 16 via rounded-md). FREE zone: header + screenshot,
// grade ring, vibe card, and the "Mingla already knows you" strip when the
// place is already on Mingla. GATED zone (CSS blur + parchment gradient
// overlay): score bars with reasons, the Google listing, the fixes, the
// competition head-to-head + outrank playbook (when the backend sends
// report.competition), and the before/after copy block. The gate card floats
// over the blur; the app CTA is
// the ATTRIBUTED business OneLink (pid/c=tool_venues — base imported from
// lib/store-links, never a hardcoded domain, per the ORCH-1399 SSOT rule).

import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { buttonClasses } from '@/components/ui/button'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { BUSINESS_ONELINK_URL } from '@/lib/store-links'
import {
  submitGrowthToolsGate,
  type GraderCompetitionEffort,
  type GraderReport,
  type GraderScoreKey,
  type GrowthToolsError,
} from '@/lib/growth-tools-submit'

// The app-gate destination: the business OneLink carrying tool attribution.
// buildOneLinkHref's campaign union is closed (bio/site campaigns only), so the
// query is constructed directly on the imported SSOT base.
const APP_GATE_HREF = `${BUSINESS_ONELINK_URL}?${new URLSearchParams({
  pid: 'tool_venues',
  c: 'tool_venues',
}).toString()}`

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const SCORE_ROWS: Array<{ key: GraderScoreKey; label: string }> = [
  { key: 'first_impression', label: 'First impression' },
  { key: 'findability', label: 'Findability' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'menu_offers', label: 'Menu & offers' },
  { key: 'occasion_signal', label: 'Occasion signal' },
]

// Effort chips for the outrank playbook — warm-tinted for this_week, neutral
// for the rest. Unknown values from the backend fall back to the neutral chip.
const EFFORT_CHIPS: Record<GraderCompetitionEffort, { label: string; className: string }> = {
  this_week: { label: 'This week', className: 'border-warm/40 bg-warm/10 text-warm-ink' },
  this_month: {
    label: 'This month',
    className: 'border-divider-strong bg-stripe-strong text-text-secondary',
  },
  project: {
    label: 'Bigger project',
    className: 'border-divider-strong bg-stripe-strong text-text-secondary',
  },
}

const GATE_ERROR_COPY: Record<GrowthToolsError, string> = {
  rate_limited: 'You’ve hit today’s limit — try again tomorrow.',
  generation_failed: 'That didn’t work — try again.',
  validation: 'Enter a valid email address.',
  server: 'That didn’t work — try again.',
  network: 'We couldn’t reach our servers — check your connection and try again.',
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function displayHost(website: string): string {
  try {
    return new URL(website).hostname.replace(/^www\./, '')
  } catch {
    return website
  }
}

function DocHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
      {children}
    </h2>
  )
}

function GradeRing({ overall, grade }: { overall: number; grade: string }) {
  const pct = clampScore(overall)
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div
        role="img"
        aria-label={`Overall grade ${grade} — ${pct} out of 100`}
        className="grid size-28 shrink-0 place-items-center rounded-full"
        style={{
          background: `conic-gradient(var(--color-warm) ${pct * 3.6}deg, var(--color-divider-strong) 0deg)`,
        }}
      >
        <div className="grid size-[5.25rem] place-items-center rounded-full bg-parchment">
          <span className="whitespace-nowrap font-display text-[clamp(1.9rem,5vw,2.4rem)] leading-none text-text-primary">
            {grade}
          </span>
        </div>
      </div>
      <div>
        <p className="whitespace-nowrap font-display text-[clamp(1.6rem,4.5vw,2.1rem)] leading-none tabular-nums text-text-primary">
          {pct}
          <span className="text-text-muted">/100</span>
        </p>
        <p className="mt-2 text-sm text-text-secondary">Overall website score</p>
      </div>
    </div>
  )
}

export function ReportView({ report, runId }: { report: GraderReport; runId: string }) {
  const [gated, setGated] = useState(true)
  const [emailOpen, setEmailOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [gateError, setGateError] = useState<GrowthToolsError | null>(null)
  const [emailedTo, setEmailedTo] = useState<string | null>(null)

  // The report first renders gated — count the gate view exactly once per run.
  useEffect(() => {
    captureMarketing('tool_gate_viewed', { tool: 'venues', run_id: runId })
  }, [runId])

  const emailValid = EMAIL_REGEX.test(email.trim())
  const host = displayHost(report.venue.website)
  const vibes = report.vibe_card.vibes.slice(0, 3)
  const photos = (report.match.photo_urls ?? []).slice(0, 3)
  // Competition is optional on the report — hide everything when absent.
  const competition = report.competition
  const competitors = (competition?.competitors ?? []).slice(0, 4)
  const playbook = (competition?.outrank_playbook ?? []).slice(0, 5)

  async function onGateSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!emailValid || submitting) return
    setSubmitting(true)
    setGateError(null)
    captureMarketing('tool_gate_email_submitted', { tool: 'venues', run_id: runId })
    const res = await submitGrowthToolsGate(runId, email.trim())
    setSubmitting(false)
    if (res.ok) {
      captureMarketing('tool_report_emailed', { tool: 'venues', run_id: runId })
      setEmailedTo(email.trim())
      setGated(false)
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
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink">
          Venue Website Grader — free report
        </p>
        <h1 className="mt-2 break-words text-[clamp(1.6rem,5vw,2.2rem)] font-bold leading-tight text-text-primary">
          {report.venue.name}
        </h1>
        <p className="mt-1 break-words text-sm text-text-secondary">
          {[report.venue.city, host].filter(Boolean).join(' · ')}
        </p>
      </header>

      {report.screenshot.og_image_url ? (
        <figure className="mt-6 overflow-hidden rounded-sm border border-divider-strong bg-white p-1.5 shadow-[var(--elev-1)]">
          <img
            src={report.screenshot.og_image_url}
            alt={`Preview of ${host}`}
            className="aspect-video w-full max-w-full rounded-[6px] object-cover"
          />
        </figure>
      ) : (
        <div className="mt-6 grid place-items-center rounded-sm border border-dashed border-divider-strong bg-stripe-strong px-4 py-10 text-center">
          <p className="text-sm text-text-muted">
            No site preview available — we graded the live site directly.
          </p>
        </div>
      )}
      {report.meta?.fetch_failed ? (
        <p className="mt-2 text-xs text-warning">
          Parts of the site didn&rsquo;t load when we visited — some grades reflect
          that (which is itself a finding).
        </p>
      ) : null}

      <div className="mt-8">
        <GradeRing overall={report.scores.overall} grade={report.scores.grade} />
      </div>

      {/* Vibe Card */}
      <section className="mt-8 rounded-sm border border-divider bg-vellum p-5 md:p-6">
        <DocHeading>Your vibe card</DocHeading>
        {vibes.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {vibes.map((vibe) => (
              <span
                key={vibe}
                className="rounded-full border border-warm/40 bg-warm/10 px-3 py-1 text-xs font-semibold text-warm-ink"
              >
                {vibe}
              </span>
            ))}
          </div>
        ) : null}
        {report.vibe_card.occasions.length > 0 ? (
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">
            <span className="font-semibold text-text-primary">Good for:</span>{' '}
            {report.vibe_card.occasions.join(' · ')}
          </p>
        ) : null}
        {report.vibe_card.signature_mention ? (
          <p className="mt-3 text-sm italic leading-relaxed text-text-secondary">
            &ldquo;{report.vibe_card.signature_mention}&rdquo;
          </p>
        ) : null}
        {report.ai_read ? (
          <p className="mt-4 border-t border-divider pt-4 text-sm leading-relaxed text-text-secondary">
            <span className="font-semibold text-text-primary">How AI reads your site:</span>{' '}
            {report.ai_read}
          </p>
        ) : null}
      </section>

      {/* Mingla already knows you — FREE zone */}
      {report.match.found ? (
        <section className="mt-6 rounded-sm border border-warm/40 bg-warm/10 p-5 md:p-6">
          <DocHeading>
            <span className="text-warm-ink">Mingla already knows you</span>
          </DocHeading>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {photos.map((url) => (
              <img
                key={url}
                src={url}
                alt=""
                className="size-16 rounded-sm object-cover"
              />
            ))}
            {typeof report.match.mingla_score === 'number' ? (
              <div>
                <p className="whitespace-nowrap font-display text-[clamp(1.4rem,4vw,1.9rem)] leading-none tabular-nums text-text-primary">
                  {clampScore(report.match.mingla_score)}
                </p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                  Mingla score
                </p>
              </div>
            ) : null}
          </div>
          {report.match.ai_read ? (
            <p className="mt-3 text-sm leading-relaxed text-text-secondary">
              {report.match.ai_read}
            </p>
          ) : null}
        </section>
      ) : null}

      {emailedTo ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-6 rounded-sm border border-warm/40 bg-warm/10 px-4 py-3 text-sm text-text-secondary"
        >
          Report emailed to <span className="font-semibold text-text-primary">{emailedTo}</span>.
        </p>
      ) : null}

      {/* Competition teaser — FREE zone, the gate's strongest hook */}
      {competitors.length > 0 ? (
        <p className="mt-6 rounded-sm border border-warm/40 bg-warm/10 px-4 py-3.5 text-sm font-semibold leading-relaxed text-warm-ink">
          We found <span className="tabular-nums">{competitors.length}</span>{' '}
          {competitors.length === 1 ? 'place' : 'places'}
          {report.venue.city ? ` in ${report.venue.city}` : ''} competing for your
          nights — the head-to-head is inside.
        </p>
      ) : null}

      {/* ── GATED ZONE ────────────────────────────────────────────────────── */}
      <section className="relative mt-8">
        <div
          aria-hidden={gated || undefined}
          className={cn(gated && 'pointer-events-none select-none blur-md')}
        >
          {/* Score bars with reasons */}
          <DocHeading>The grades</DocHeading>
          <ul className="mt-4 space-y-5">
            {SCORE_ROWS.map(({ key, label }) => {
              const value = clampScore(report.scores[key])
              const reason = report.scores.reasons[key]
              return (
                <li key={key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-text-primary">{label}</span>
                    <span className="whitespace-nowrap text-[clamp(0.95rem,2.5vw,1.05rem)] font-semibold tabular-nums text-text-primary">
                      {value}
                      <span className="text-text-muted">/100</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-divider-strong">
                    <div
                      className="h-full rounded-full bg-warm"
                      style={{ width: `${value}%` }}
                    />
                  </div>
                  {reason ? (
                    <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                      {reason}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>

          {/* Google listing */}
          {report.google_listing.lines.length > 0 ? (
            <div className="mt-10">
              <DocHeading>Your Google listing</DocHeading>
              <div className="mt-4 space-y-1 rounded-sm border border-divider-strong bg-white p-4">
                {report.google_listing.lines.map((line, i) => (
                  <p
                    key={`${i}-${line.slice(0, 24)}`}
                    className={cn(
                      'break-words text-sm leading-relaxed',
                      i === 0 ? 'font-semibold text-text-primary' : 'text-text-secondary',
                    )}
                  >
                    {line}
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {/* Fixes */}
          {report.fixes.length > 0 ? (
            <div className="mt-10">
              <DocHeading>Your fixes</DocHeading>
              <ol className="mt-4 space-y-4">
                {report.fixes.map((fix, i) => (
                  <li
                    key={fix.title}
                    className="rounded-sm border border-divider bg-white p-4 md:p-5"
                  >
                    <p className="text-sm font-semibold text-text-primary">
                      <span className="tabular-nums text-warm-ink">{i + 1}.</span>{' '}
                      {fix.title}
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                      {fix.why}
                    </p>
                    <p className="mt-3 rounded-sm bg-vellum p-3 text-sm leading-relaxed text-text-primary">
                      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-warm-ink">
                        Change:{' '}
                      </span>
                      {fix.change}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {/* Competition — head-to-head */}
          {competitors.length > 0 ? (
            <div className="mt-10">
              <DocHeading>Who&rsquo;s eating your Friday nights</DocHeading>
              {competition?.your_rank_read ? (
                <p className="mt-4 text-sm leading-relaxed text-text-secondary">
                  {competition.your_rank_read}
                </p>
              ) : null}
              <ul className="mt-4 space-y-4">
                {competitors.map((competitor, i) => (
                  <li
                    key={`${competitor.name}-${i}`}
                    className="rounded-sm border border-divider bg-white p-4 md:p-5"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <p className="min-w-0 break-words text-sm font-semibold text-text-primary">
                        {competitor.name}
                        {competitor.city ? (
                          <span className="font-normal text-text-muted">
                            {' '}
                            · {competitor.city}
                          </span>
                        ) : null}
                      </p>
                      {typeof competitor.mingla_score === 'number' ? (
                        <span className="whitespace-nowrap rounded-full border border-warm/40 bg-warm/10 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-warm-ink">
                          Mingla score {clampScore(competitor.mingla_score)}
                        </span>
                      ) : null}
                    </div>
                    {competitor.what_they_do_better.length > 0 ? (
                      <ul className="mt-2.5 space-y-1.5">
                        {competitor.what_they_do_better.slice(0, 3).map((point) => (
                          <li
                            key={point}
                            className="flex gap-2 text-sm leading-relaxed text-text-secondary"
                          >
                            <span aria-hidden="true" className="shrink-0 text-warm-ink">
                              •
                            </span>
                            <span className="min-w-0 break-words">{point}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {competitor.evidence ? (
                      <p className="mt-2.5 break-words text-xs leading-relaxed text-text-muted">
                        {competitor.evidence}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Outrank playbook */}
          {playbook.length > 0 ? (
            <div className="mt-10">
              <DocHeading>How to outrank them</DocHeading>
              <ol className="mt-4 space-y-4">
                {playbook.map((move, i) => {
                  const chip = EFFORT_CHIPS[move.effort] ?? EFFORT_CHIPS.project
                  return (
                    <li
                      key={`${move.move}-${i}`}
                      className="rounded-sm border border-divider bg-white p-4 md:p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                        <p className="min-w-0 flex-1 break-words text-sm font-semibold text-text-primary">
                          <span className="tabular-nums text-warm-ink">{i + 1}.</span>{' '}
                          {move.move}
                        </p>
                        <span
                          className={cn(
                            'whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                            chip.className,
                          )}
                        >
                          {chip.label}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                        {move.why_it_works}
                      </p>
                    </li>
                  )
                })}
              </ol>
            </div>
          ) : null}

          {/* Before / After copy */}
          <div className="mt-10">
            <DocHeading>Your homepage, rewritten</DocHeading>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-sm border border-divider bg-white p-4 md:p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                  Before — your site now
                </p>
                <p className="mt-3 break-words text-sm italic leading-relaxed text-text-secondary">
                  &ldquo;{report.rewritten_hero.before_excerpt}&rdquo;
                </p>
              </div>
              <div className="rounded-sm border border-warm/40 bg-warm/10 p-4 md:p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warm-ink">
                  After — written to convert
                </p>
                <p className="mt-3 break-words text-sm font-medium leading-relaxed text-text-primary">
                  {report.rewritten_hero.after_copy}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Gate overlay + floating gate card */}
        {gated ? (
          <div className="absolute inset-0">
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-b from-parchment/30 via-parchment/70 to-parchment"
            />
            <div className="relative mx-auto mt-4 max-w-md px-1 sm:mt-8">
              <div className="rounded-md border border-divider-strong bg-parchment p-5 text-center shadow-[0_24px_80px_rgba(14,14,16,0.28)] sm:p-6">
                <p className="font-display text-2xl text-text-primary">
                  Your full report is ready
                </p>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                  Every grade with its reason, your Google listing, your fixes, and
                  your homepage rewritten.
                </p>
                <a
                  href={APP_GATE_HREF}
                  target="_blank"
                  rel="noopener"
                  onClick={() =>
                    captureMarketing('tool_gate_app_click', {
                      tool: 'venues',
                      run_id: runId,
                      location: 'gate',
                    })
                  }
                  className={buttonClasses({ variant: 'primary', className: 'mt-5 w-full' })}
                >
                  View on Mingla app
                </a>
                {!emailOpen ? (
                  <button
                    type="button"
                    onClick={() => setEmailOpen(true)}
                    className="mt-3 rounded-sm text-sm font-semibold text-warm-ink underline-offset-4 transition hover:underline focus-ring"
                  >
                    Continue on web — email me it
                  </button>
                ) : (
                  <form onSubmit={onGateSubmit} noValidate className="mt-4 text-left">
                    <label
                      htmlFor="gate-email"
                      className="block text-xs font-semibold uppercase tracking-[0.16em] text-text-muted"
                    >
                      Your email <span aria-hidden="true" className="text-warm">*</span>
                    </label>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <input
                        id="gate-email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@yourplace.com"
                        aria-invalid={email.trim().length > 0 && !emailValid}
                        className="min-h-11 w-full min-w-0 flex-1 rounded-sm border border-divider-strong bg-white px-3 text-base text-text-primary placeholder:text-text-muted focus-ring"
                      />
                      <button
                        type="submit"
                        disabled={!emailValid || submitting}
                        className={buttonClasses({
                          variant: 'primary',
                          size: 'sm',
                          className: 'whitespace-nowrap',
                        })}
                      >
                        {submitting ? 'Sending…' : 'Email me it'}
                      </button>
                    </div>
                    {gateError ? (
                      <p role="alert" className="mt-2 text-sm text-danger">
                        {GATE_ERROR_COPY[gateError]}
                      </p>
                    ) : null}
                  </form>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── PIVOT (post-unlock) ───────────────────────────────────────────── */}
      {!gated ? (
        <div
          data-theme="dark"
          className="mt-10 rounded-md border border-white/12 p-6 md:p-8"
          style={{ background: 'var(--bg-spotlight)' }}
        >
          <p className="font-display text-2xl leading-snug text-white">
            Or skip the rebuild — your Mingla page already does all of this.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/70">
            Vibe, occasions, photos, booking — one page that already speaks
            first-timer. Claim it and point your links there.
          </p>
          <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <a
              href={APP_GATE_HREF}
              target="_blank"
              rel="noopener"
              onClick={() =>
                captureMarketing('tool_gate_app_click', {
                  tool: 'venues',
                  run_id: runId,
                  location: 'pivot',
                })
              }
              className={buttonClasses({ variant: 'primary' })}
            >
              Claim your Mingla page
            </a>
            <a
              href="mailto:seth@usemingla.com?subject=Fix%20my%20website%20(Mingla)"
              className="rounded-sm text-sm font-semibold text-warm underline-offset-4 transition hover:underline focus-ring"
            >
              Or let us fix it for you — free
            </a>
          </div>
        </div>
      ) : null}
    </article>
  )
}
