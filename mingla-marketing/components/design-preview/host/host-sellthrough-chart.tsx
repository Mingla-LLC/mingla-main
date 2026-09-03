'use client'
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { AnimatedBar, ChartEntrance } from '@/components/ui/chart-entrance'
import { ProvenanceChip } from '@/components/design-preview/system/provenance-chip'

// #2902 — the Host interactive chart: sell-through across a sale window.
//
// Every number in here is invented, so the panel wears the `illustrative` label
// at rest — in the header, not in a tooltip and not only in a source comment.
// The current `/host` charts carry "illustrative" ONLY in their code comments
// while rendering as public proof; that is the specific failure this replaces.
//
// What it demonstrates truthfully is the SHAPE of a real ticketed sale: a spike
// on announce, a long flat middle, and a much larger spike in the final week.
// The lesson in the caption is the useful part, and it is true regardless of
// the numbers used to draw it.

const EASE = [0.16, 1, 0.3, 1] as const

interface Tier {
  id: string
  label: string
  price: string
  capacity: number
  /** Units sold per day across a 14-day window. Invented. */
  daily: readonly number[]
}

const TIERS: readonly Tier[] = [
  {
    id: 'early',
    label: 'Early release',
    price: '£12',
    capacity: 60,
    daily: [22, 14, 8, 5, 3, 2, 2, 1, 1, 1, 0, 1, 0, 0],
  },
  {
    id: 'general',
    label: 'General admission',
    price: '£18',
    capacity: 220,
    daily: [12, 9, 6, 5, 4, 4, 6, 7, 9, 12, 16, 24, 31, 11],
  },
  {
    id: 'table',
    label: 'Table of six',
    price: '£150',
    capacity: 12,
    daily: [1, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 2, 1, 0],
  },
]

const DAY_LABELS = [
  'Announce',
  '',
  '',
  '',
  '',
  '',
  'Wk 1',
  '',
  '',
  '',
  '',
  '',
  '',
  'Doors',
] as const

export function HostSellThroughChart() {
  const reduced = useMinglaReducedMotion()
  const [activeId, setActiveId] = useState<string>(TIERS[1].id)

  const tier = useMemo(
    () => TIERS.find((t) => t.id === activeId) ?? TIERS[0],
    [activeId],
  )

  const sold = useMemo(() => tier.daily.reduce((a, b) => a + b, 0), [tier])
  const peak = useMemo(() => Math.max(...tier.daily), [tier])
  const sellThrough = Math.round((sold / tier.capacity) * 100)
  const finalWeek = useMemo(
    () => tier.daily.slice(7).reduce((a, b) => a + b, 0),
    [tier],
  )
  const finalWeekShare = sold > 0 ? Math.round((finalWeek / sold) * 100) : 0

  return (
    <ChartEntrance
      lightTheme
      className="font-dashboard w-full overflow-hidden rounded-2xl bg-white p-5 ring-1 ring-[rgba(14,14,16,0.05)] sm:p-7"
      style={{ boxShadow: 'var(--elev-3)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-xl leading-tight tracking-[-0.015em] text-text-primary">
            Sell-through across a two-week sale
          </h3>
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-text-muted">
            Switch tiers to see how differently each one moves.
          </p>
        </div>
        <ProvenanceChip kind="illustrative" className="shrink-0" />
      </div>

      <div
        role="tablist"
        aria-label="Ticket tier"
        className="mt-6 grid gap-2 sm:grid-cols-3"
      >
        {TIERS.map((t) => {
          const isActive = t.id === activeId
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveId(t.id)}
              className={cn(
                'min-h-11 rounded-full px-3 py-2 text-xs font-semibold transition-colors duration-200 focus-ring',
                isActive
                  ? 'bg-warm text-white'
                  : 'bg-black/[0.04] text-text-secondary hover:bg-black/[0.07] hover:text-text-primary',
              )}
            >
              {t.label} · {t.price}
            </button>
          )
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tier.id}
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: reduced ? 0 : 0.3, ease: EASE }}
        >
          <div className="mt-7 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                Sold
              </p>
              <p className="mt-1 text-3xl font-bold leading-none tabular-nums text-text-primary">
                {sold}
                <span className="text-base font-semibold text-text-muted"> / {tier.capacity}</span>
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                Sell-through
              </p>
              <p
                className="mt-1 text-3xl font-bold leading-none tabular-nums"
                style={{ color: 'var(--color-warm-ink)' }}
              >
                {sellThrough}%
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                Sold in the final week
              </p>
              <p className="mt-1 text-3xl font-bold leading-none tabular-nums text-text-primary">
                {finalWeekShare}%
              </p>
            </div>
          </div>

          <div className="mt-7">
            <div className="flex h-28 items-end gap-1.5" aria-hidden="true">
              {tier.daily.map((v, i) => (
                <AnimatedBar
                  key={`${tier.id}-${i}`}
                  axis="y"
                  className="flex-1 rounded-t-md"
                  size={`${peak === 0 ? 0 : Math.max((v / peak) * 100, 2)}%`}
                  delay={0.05 + i * 0.03}
                  style={{
                    background:
                      i >= 10
                        ? 'var(--color-warm)'
                        : 'color-mix(in srgb, var(--color-warm) 30%, transparent)',
                  }}
                />
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">
              {DAY_LABELS.map((label, i) => (
                <span
                  key={i}
                  className="flex-1 text-center text-[9px] font-semibold uppercase tracking-wide text-text-muted"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* The real, defensible takeaway. */}
          <p className="mt-6 rounded-xl bg-warm/[0.06] px-4 py-3 text-xs leading-relaxed text-text-secondary">
            <span className="font-semibold text-text-primary">Read the shape, not the totals.</span>{' '}
            Ticketed events sell at announce and again in the last few days, with a long flat middle
            that panics organisers into discounting too early. Knowing which tier is carrying the
            final week is the difference between a price change and a nervous one.
          </p>
        </motion.div>
      </AnimatePresence>

    </ChartEntrance>
  )
}
