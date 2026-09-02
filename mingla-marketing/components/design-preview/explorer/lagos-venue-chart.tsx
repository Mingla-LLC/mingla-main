'use client'
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Star } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { AnimatedBar, ChartEntrance } from '@/components/ui/chart-entrance'
import { LAGOS_VENUES, type LagosVenue } from '@/lib/design-preview/lagos-truth'
import { ProvenanceChip } from '@/components/design-preview/system/provenance-chip'

// #2902 — the Explorer interactive chart.
//
// DELIBERATE CHOICE: this chart plots REAL data. Rating and review count for
// all ten Lagos venues are verbatim place-pool records, so the chart is a
// genuine piece of local research rather than a decorative demo — which is
// exactly the kind of asset the search half of #2902 needs. No figure here is
// invented, so it carries the first-party label, not the illustrative one.

const EASE = [0.16, 1, 0.3, 1] as const

const MODES = [
  { id: 'reviews', label: 'Most reviewed', unit: 'reviews' },
  { id: 'rating', label: 'Highest rated', unit: 'rating' },
] as const

type ModeId = (typeof MODES)[number]['id']

function formatReviews(n: number): string {
  return n.toLocaleString('en-US')
}

export function LagosVenueChart() {
  const reduced = useMinglaReducedMotion()
  const [mode, setMode] = useState<ModeId>('reviews')
  const [selected, setSelected] = useState<string>(LAGOS_VENUES[0]?.placeKey ?? '')

  const rows = useMemo(() => {
    const sorted = [...LAGOS_VENUES].sort((a, b) =>
      mode === 'reviews' ? b.reviewCount - a.reviewCount : b.rating - a.rating,
    )
    const max =
      mode === 'reviews'
        ? Math.max(...sorted.map((v) => v.reviewCount))
        : 5
    return sorted.map((v) => ({
      venue: v,
      value: mode === 'reviews' ? v.reviewCount : v.rating,
      pct: mode === 'reviews' ? (v.reviewCount / max) * 100 : (v.rating / max) * 100,
      display: mode === 'reviews' ? formatReviews(v.reviewCount) : v.rating.toFixed(1),
    }))
  }, [mode])

  const detail: LagosVenue | undefined = useMemo(
    () => LAGOS_VENUES.find((v) => v.placeKey === selected),
    [selected],
  )

  return (
    <ChartEntrance
      lightTheme
      className="font-dashboard w-full overflow-hidden rounded-2xl bg-white p-5 ring-1 ring-[rgba(14,14,16,0.05)] sm:p-7"
      style={{ boxShadow: 'var(--elev-3)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-xl leading-tight tracking-[-0.015em] text-text-primary">
            Ten Lagos places, by what Lagos actually says about them
          </h3>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-text-muted">
            One venue per Mingla category, drawn from our own place pool. Select a bar to read the
            record.
          </p>
        </div>
        <ProvenanceChip kind="first-party" className="shrink-0" />
      </div>

      <div
        role="tablist"
        aria-label="Sort Lagos venues"
        className="mt-6 inline-flex gap-2 rounded-full bg-black/[0.04] p-1"
      >
        {MODES.map((m) => {
          const isActive = m.id === mode
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setMode(m.id)}
              className={cn(
                'min-h-11 rounded-full px-4 text-xs font-semibold transition-colors duration-200 focus-ring',
                isActive
                  ? 'bg-warm text-white'
                  : 'text-text-secondary hover:bg-black/[0.04] hover:text-text-primary',
              )}
            >
              {m.label}
            </button>
          )
        })}
      </div>

      <ul className="mt-6 space-y-2.5">
        {rows.map((row, i) => {
          const isSelected = row.venue.placeKey === selected
          return (
            <li key={row.venue.placeKey}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelected(row.venue.placeKey)}
                className={cn(
                  'group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-200 focus-ring',
                  isSelected ? 'bg-warm/[0.07]' : 'hover:bg-black/[0.03]',
                )}
              >
                <span className="w-[38%] shrink-0 truncate text-[13px] font-semibold text-text-primary sm:w-[32%]">
                  {row.venue.name}
                </span>
                <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
                  <AnimatedBar
                    className="block h-full rounded-full"
                    size={`${row.pct}%`}
                    delay={0.06 + i * 0.045}
                    style={{
                      background: isSelected
                        ? 'var(--color-warm)'
                        : 'color-mix(in srgb, var(--color-warm) 42%, transparent)',
                    }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right text-[13px] font-semibold tabular-nums text-text-primary">
                  {row.display}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <AnimatePresence mode="wait">
        {detail ? (
          <motion.div
            key={detail.placeKey}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: reduced ? 0 : 0.26, ease: EASE }}
            className="mt-6 flex gap-4 rounded-xl border border-black/[0.06] bg-black/[0.015] p-3.5"
          >
            <img
              src={detail.photo}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              draggable={false}
              className="h-20 w-20 shrink-0 rounded-lg object-cover"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-text-primary">{detail.name}</p>
              <p className="mt-0.5 text-xs text-text-muted">{detail.category}</p>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
                  <Star
                    className="h-3.5 w-3.5 fill-current text-[var(--color-warm-ink)]"
                    aria-hidden="true"
                  />
                  {detail.rating.toFixed(1)}
                </span>
                <span className="tabular-nums">
                  {formatReviews(detail.reviewCount)} reviews
                </span>
                {detail.priceRange ? (
                  <span className="tabular-nums">{detail.priceRange}</span>
                ) : null}
              </p>
              {detail.blurb ? (
                <p className="mt-2 text-xs leading-relaxed text-text-muted">{detail.blurb}</p>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <p className="mt-5 text-[11px] leading-relaxed text-text-muted">
        Ratings and review counts are the public Google records Mingla stores against each place.
        They describe the venue, not an event at it — Mingla claims no event, price or availability
        for any venue on this page.
      </p>
    </ChartEntrance>
  )
}
