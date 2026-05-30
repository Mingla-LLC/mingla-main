'use client'
import { motion } from 'framer-motion'
import { TrendingUp } from 'lucide-react'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { cn } from '@/lib/cn'

// ORCH-1010 — adapted from 21st.dev StatisticCard5 (reui) balance card into an
// "Earnings" card. The source ships as a zinc-900 dark card with a big balance,
// a delta, a Topup button, and a 5-currency segmented bar with a code+percent
// legend. Adapted to: LIGHT white card (elev-3) + warm accents, dashboard font
// (Inter), a "99% kept" success chip in place of Topup, and a revenue-by-
// category segmented bar (Events / Reservations / Trips / Experiences) in the
// warm family. All figures are ILLUSTRATIVE Mingla mockups (ORCH-1007 reality-
// anchor), not live account metrics.

interface Segment {
  code: string
  label: string
  pct: number
  color: string
}

// Warm-family shades. Percentages sum to 100.
const SEGMENTS: Segment[] = [
  { code: 'EV', label: 'Events', pct: 46, color: '#eb7825' },
  { code: 'RS', label: 'Reservations', pct: 28, color: '#f4965a' },
  { code: 'TR', label: 'Trips', pct: 16, color: '#f9b98a' },
  { code: 'EX', label: 'Experiences', pct: 10, color: '#fcd9bf' },
]

export function EarningsCard() {
  const reduced = useMinglaReducedMotion()

  return (
    <div
      className="font-dashboard w-full overflow-hidden rounded-2xl bg-white p-6 ring-1 ring-[rgba(14,14,16,0.05)] md:p-7"
      style={{ boxShadow: 'var(--elev-3)' }}
    >
      {/* Label + kept chip */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Earnings
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(63,139,92,0.10)] px-2.5 py-1 text-xs font-semibold text-[var(--color-success)] ring-1 ring-inset ring-[rgba(63,139,92,0.22)]">
          99% kept
        </span>
      </div>

      {/* Big value + delta */}
      <div className="mt-3 flex items-end gap-3">
        <span className="text-4xl font-bold leading-none tabular-nums text-text-primary md:text-5xl">
          $24,310
        </span>
        <span className="mb-1 inline-flex items-center gap-0.5 text-sm font-semibold text-[var(--color-success)]">
          <TrendingUp className="size-4" strokeWidth={2.4} aria-hidden="true" />
          +18%
        </span>
      </div>
      <p className="mt-1.5 text-xs text-text-muted">vs. last 30 days</p>

      {/* Revenue-by-category segmented bar */}
      <div className="mt-7 flex h-2.5 w-full overflow-hidden rounded-full bg-[rgba(14,14,16,0.05)]">
        {SEGMENTS.map((seg, i) => (
          <motion.div
            key={seg.code}
            className={cn('h-full', i > 0 && 'border-l-2 border-white')}
            style={reduced ? { background: seg.color, width: `${seg.pct}%` } : { background: seg.color }}
            initial={reduced ? false : { width: 0 }}
            animate={reduced ? false : { width: `${seg.pct}%` }}
            transition={reduced ? undefined : { duration: 0.7, delay: 0.1 + i * 0.08, ease: 'easeOut' }}
          />
        ))}
      </div>

      {/* Legend: code + percent */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
        {SEGMENTS.map((seg) => (
          <div key={seg.code} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 flex-shrink-0 rounded-full"
              style={{ background: seg.color }}
            />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="text-xs font-semibold text-text-primary">
                {seg.code} <span className="tabular-nums text-text-secondary">{seg.pct}%</span>
              </span>
              <span className="truncate text-[0.68rem] text-text-muted">{seg.label}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
