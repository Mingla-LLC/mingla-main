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
import { motion, useReducedMotion } from 'framer-motion'
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
  type SignalStatus,
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

// Site-health chip styling per status — moss/butter/danger tints, and the mark.
const SIGNAL_STYLE: Record<SignalStatus, { mark: string; className: string }> = {
  pass: { mark: '✓', className: 'border-moss/40 bg-moss/12 text-moss' },
  warn: { mark: '!', className: 'border-butter/50 bg-butter/15 text-warning' },
  fail: { mark: '✗', className: 'border-danger/30 bg-danger/10 text-danger' },
}

function DocHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
      {children}
    </h2>
  )
}

// Interactive before/after: the redesigned homepage (after) clipped over the
// current site (before), split by a range slider. Keyboard-accessible; the clip
// is the only thing that moves, so it's smooth and dependency-free.
function BeforeAfterSlider({
  before,
  after,
  host,
}: {
  before: string
  after: string
  host: string
}) {
  const [pos, setPos] = useState(50)
  return (
    <div>
      <div className="relative select-none overflow-hidden rounded-sm border border-divider-strong bg-black">
        <img
          src={before}
          alt={`Current site — ${host}`}
          loading="lazy"
          className="block aspect-[16/10] w-full max-w-full object-cover object-top"
          draggable={false}
        />
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
        >
          <img
            src={after}
            alt="Redesigned in a Mingla template"
            loading="lazy"
            className="block aspect-[16/10] w-full max-w-full object-cover object-top"
            draggable={false}
          />
        </div>
        {/* Divider + handle */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
          style={{ left: `${pos}%` }}
        >
          <span className="absolute top-1/2 left-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-[11px] font-bold text-ink shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
            ⇄
          </span>
        </div>
        {/* Labels */}
        <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
          Before
        </span>
        <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-warm px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
          After
        </span>
      </div>
      <label className="sr-only" htmlFor="ba-slider">
        Drag to compare before and after
      </label>
      <input
        id="ba-slider"
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        className="mt-3 w-full accent-warm"
        aria-label="Compare your current site with the redesign"
      />
      <p className="mt-1 text-center text-xs text-text-muted">
        Drag to compare — your site now vs. rebuilt in a Mingla template
      </p>
    </div>
  )
}

// Count a number up to `target` over ~800ms once mounted. Honors reduced motion
// (jumps straight to the value). SSR-safe: starts from the target so the first
// paint is never wrong if JS is slow.
function useCountUp(target: number, enabled: boolean): number {
  const [value, setValue] = useState(enabled ? 0 : target)
  useEffect(() => {
    if (!enabled) {
      setValue(target)
      return
    }
    let raf = 0
    let start: number | null = null
    const duration = 800
    const tick = (t: number) => {
      if (start === null) start = t
      const p = Math.min(1, (t - start) / duration)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(target * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, enabled])
  return value
}

function GradeRing({
  overall,
  grade,
  percentile,
}: {
  overall: number
  grade: string
  percentile?: { city: string; better_than_pct: number; sample: number }
}) {
  const pct = clampScore(overall)
  const reduce = useReducedMotion()
  const animate = !reduce
  const shown = useCountUp(pct, animate)
  // SVG ring geometry.
  const R = 52
  const C = 2 * Math.PI * R
  const offset = C * (1 - pct / 100)

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div
        role="img"
        aria-label={`Overall grade ${grade} — ${pct} out of 100`}
        className="relative grid size-28 shrink-0 place-items-center"
      >
        <svg viewBox="0 0 120 120" className="size-28 -rotate-90">
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke="var(--color-divider-strong)"
            strokeWidth="12"
          />
          <motion.circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke="var(--color-warm)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={C}
            initial={{ strokeDashoffset: animate ? C : offset }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: animate ? 1 : 0, ease: 'easeOut' }}
          />
        </svg>
        <span className="absolute font-display text-[clamp(1.9rem,5vw,2.4rem)] leading-none text-text-primary">
          {grade}
        </span>
      </div>
      <div>
        <p className="whitespace-nowrap font-display text-[clamp(1.6rem,4.5vw,2.1rem)] leading-none tabular-nums text-text-primary">
          {shown}
          <span className="text-text-muted">/100</span>
        </p>
        <p className="mt-2 text-sm text-text-secondary">Overall website score</p>
        {percentile ? (
          <p className="mt-1.5 text-sm font-semibold text-warm-ink">
            Better than{' '}
            <span className="tabular-nums">{clampScore(percentile.better_than_pct)}%</span> of{' '}
            <span className="tabular-nums">{percentile.sample.toLocaleString()}</span> scored
            venues in {percentile.city}
          </p>
        ) : null}
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
  // Depth fields — all optional, each hides gracefully.
  const checks = report.site_signals?.checks ?? []
  const passCount = checks.filter((c) => c.status === 'pass').length
  const warnCount = checks.filter((c) => c.status === 'warn').length
  const failCount = checks.filter((c) => c.status === 'fail').length
  const praise = report.review_themes?.praise ?? []
  const complaints = report.review_themes?.complaints ?? []
  const headToHead = report.head_to_head
  const hhRows = (headToHead?.rows ?? []).slice(0, 6)
  const whereYouWin = (report.where_you_win ?? []).slice(0, 3)
  const offerFrom = report.offer?.per_person_from ?? '$3.99'
  // Prefer the live ScreenshotOne capture; fall back to the site's og:image.
  const siteImage = report.screenshot.image_url || report.screenshot.og_image_url || null
  const afterImage = report.screenshot.after_url || null

  // The offer view fires once, when the report first renders unlocked.
  useEffect(() => {
    if (!gated) captureMarketing('tool_offer_view', { tool: 'venues', run_id: runId })
  }, [gated, runId])

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

      {siteImage ? (
        <figure className="mt-6 overflow-hidden rounded-sm border border-divider-strong bg-white p-1.5 shadow-[var(--elev-1)]">
          <img
            src={siteImage}
            alt={`Live screenshot of ${host}`}
            loading="lazy"
            className="aspect-[16/10] w-full max-w-full rounded-[6px] object-cover object-top"
          />
          <figcaption className="px-1 py-1.5 text-center text-xs text-text-muted">
            Your site right now — {host}
          </figcaption>
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
        <GradeRing
          overall={report.scores.overall}
          grade={report.scores.grade}
          percentile={report.percentile}
        />
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

      {/* Site health — FREE zone, deterministic checks (credibility bait) */}
      {checks.length > 0 ? (
        <section className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <DocHeading>Site health check</DocHeading>
            <p className="text-xs font-semibold tabular-nums text-text-muted">
              <span className="text-moss">{passCount} passed</span> ·{' '}
              <span className="text-warning">{warnCount} warning{warnCount === 1 ? '' : 's'}</span> ·{' '}
              <span className="text-danger">{failCount} failing</span>
            </p>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {checks.map((c) => {
              const style = SIGNAL_STYLE[c.status] ?? SIGNAL_STYLE.warn
              return (
                <li
                  key={c.key}
                  className={cn(
                    'flex gap-2.5 rounded-sm border p-3',
                    style.className,
                  )}
                >
                  <span aria-hidden="true" className="mt-px shrink-0 font-bold leading-none">
                    {style.mark}
                  </span>
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-semibold text-text-primary">
                      {c.label}
                    </span>
                    {c.detail ? (
                      <span className="mt-0.5 block break-words text-xs leading-relaxed text-text-secondary">
                        {c.detail}
                      </span>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

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

      {/* Teasers — FREE zone, the gate's strongest hooks */}
      {competitors.length > 0 ? (
        <p className="mt-6 rounded-sm border border-warm/40 bg-warm/10 px-4 py-3.5 text-sm font-semibold leading-relaxed text-warm-ink">
          We found <span className="tabular-nums">{competitors.length}</span>{' '}
          {competitors.length === 1 ? 'place' : 'places'}
          {report.venue.city ? ` in ${report.venue.city}` : ''} competing for your
          nights — the head-to-head scorecard is inside.
        </p>
      ) : null}
      <p className="mt-3 rounded-sm border border-warm/40 bg-warm/10 px-4 py-3.5 text-sm font-semibold leading-relaxed text-warm-ink">
        Inside: how Mingla drives people to your venue from {offerFrom} per person.
      </p>

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
                    <motion.div
                      className="h-full rounded-full bg-warm"
                      initial={{ width: 0 }}
                      whileInView={{ width: `${value}%` }}
                      viewport={{ once: true, amount: 0.6 }}
                      transition={{ duration: 0.7, ease: 'easeOut' }}
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

          {/* What your customers say — real review themes */}
          {praise.length > 0 || complaints.length > 0 ? (
            <div className="mt-10">
              <DocHeading>What your customers say</DocHeading>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {praise.length > 0 ? (
                  <div className="rounded-sm border border-moss/40 bg-moss/10 p-4 md:p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-moss">
                      People love
                    </p>
                    <ul className="mt-3 space-y-2">
                      {praise.map((s) => (
                        <li key={s} className="flex gap-2 text-sm leading-relaxed text-text-secondary">
                          <span aria-hidden="true" className="shrink-0 text-moss">+</span>
                          <span className="min-w-0 break-words">{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {complaints.length > 0 ? (
                  <div className="rounded-sm border border-divider bg-white p-4 md:p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                      What comes up as a gripe
                    </p>
                    <ul className="mt-3 space-y-2">
                      {complaints.map((s) => (
                        <li key={s} className="flex gap-2 text-sm leading-relaxed text-text-secondary">
                          <span aria-hidden="true" className="shrink-0 text-warning">–</span>
                          <span className="min-w-0 break-words">{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
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
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                      <p className="min-w-0 flex-1 break-words text-sm font-semibold text-text-primary">
                        <span className="tabular-nums text-warm-ink">{i + 1}.</span>{' '}
                        {fix.title}
                      </p>
                      <span
                        className={cn(
                          'whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                          fix.impact === 'high'
                            ? 'border-warm/40 bg-warm/10 text-warm-ink'
                            : 'border-divider-strong bg-stripe-strong text-text-secondary',
                        )}
                      >
                        {fix.impact === 'high' ? 'High impact' : 'Medium'}
                      </span>
                    </div>
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

          {/* Head-to-head scorecard */}
          {headToHead && hhRows.length > 0 ? (
            <div className="mt-10">
              <DocHeading>You vs {headToHead.competitor}</DocHeading>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[26rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-divider-strong">
                      <th className="py-2 pr-3 text-left font-semibold text-text-muted" />
                      <th className="py-2 pr-3 text-left font-semibold text-text-primary">You</th>
                      <th className="break-words py-2 text-left font-semibold text-text-muted">
                        {headToHead.competitor}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {hhRows.map((row, i) => (
                      <tr key={`${row.dimension}-${i}`} className="border-b border-divider align-top">
                        <td className="py-2.5 pr-3 text-text-muted">{row.dimension}</td>
                        <td
                          className={cn(
                            'py-2.5 pr-3',
                            row.winner === 'you'
                              ? 'rounded-sm bg-warm/10 font-semibold text-warm-ink'
                              : 'text-text-secondary',
                          )}
                        >
                          {row.you}
                        </td>
                        <td
                          className={cn(
                            'py-2.5',
                            row.winner === 'them'
                              ? 'rounded-sm bg-warm/10 font-semibold text-warm-ink'
                              : 'text-text-secondary',
                          )}
                        >
                          {row.them}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Where you already win */}
          {whereYouWin.length > 0 ? (
            <div className="mt-10">
              <DocHeading>Where you already win</DocHeading>
              <ul className="mt-4 space-y-2.5">
                {whereYouWin.map((s) => (
                  <li key={s} className="flex gap-2.5 text-sm leading-relaxed text-text-primary">
                    <span aria-hidden="true" className="mt-px shrink-0 font-bold text-moss">✓</span>
                    <span className="min-w-0 break-words">{s}</span>
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

          {/* Before / After — the visual redesign */}
          <div className="mt-10">
            <DocHeading>Your homepage, redesigned</DocHeading>
            {siteImage && afterImage ? (
              <div className="mt-4">
                <BeforeAfterSlider before={siteImage} after={afterImage} host={host} />
              </div>
            ) : null}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-sm border border-divider bg-white p-4 md:p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                  Before — your headline now
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

      {/* ── THE OFFER (the wow close, post-unlock) ────────────────────────── */}
      {!gated ? (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="mt-6 overflow-hidden rounded-md p-6 text-white md:p-8"
          style={{
            background:
              'linear-gradient(135deg, var(--color-warm) 0%, var(--color-warm-hover) 100%)',
          }}
        >
          <p className="break-words font-display text-[clamp(1.6rem,4.5vw,2.2rem)] leading-tight">
            We can drive people to your venue for as low as{' '}
            <span className="whitespace-nowrap">{offerFrom}</span> per person.
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/90 md:text-base">
            That&rsquo;s the introductory Mingla promotion — claim your page or book a free
            call and we&rsquo;ll show you the math for your venue.
          </p>
          <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <a
              href={APP_GATE_HREF}
              target="_blank"
              rel="noopener"
              onClick={() =>
                captureMarketing('tool_offer_cta_click', {
                  tool: 'venues',
                  run_id: runId,
                  cta: 'claim',
                })
              }
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-warm-ink transition hover:bg-white/90 focus-ring"
            >
              Claim your page &amp; get the offer
            </a>
            <a
              href="mailto:seth@usemingla.com?subject=Drive%20people%20to%20my%20venue%20(Mingla%20offer)"
              onClick={() =>
                captureMarketing('tool_offer_cta_click', {
                  tool: 'venues',
                  run_id: runId,
                  cta: 'call',
                })
              }
              className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-white underline-offset-4 transition hover:underline focus-ring"
            >
              Book a free call
            </a>
          </div>
        </motion.div>
      ) : null}
    </article>
  )
}
