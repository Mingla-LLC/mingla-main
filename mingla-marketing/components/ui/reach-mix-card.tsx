'use client'

// ---------------------------------------------------------------
// #2902 — the AI brain figure: the four ways people find you.
//
// Paid, earned, shared and owned, stacked, on the ruled grid the source card
// uses. Drawn as inline SVG: the original is a recharts AreaChart, and pulling
// recharts plus next-themes into the marketing bundle to decorate one card is
// not a trade worth making. Four polygons and a clip reveal do the same job.
//
// WHAT IS DELIBERATELY MISSING: every number. The source leads on "16.9%",
// "+2.1%", "3,842 added to cart" -- conversion metrics and deltas. Inventing
// those here would be exactly the fabricated performance claim this whole pass
// is under orders to avoid, and it is the same reason $2.4M+ and 35k+ came off
// the page. So there is no axis, no percentage, no count and no trend badge.
// The chart shows a MIX, not a result: what the four channels are, and that
// Ari works all of them at once.
//
// The bands vary gently rather than ramping, for the same reason -- a hockey
// stick is a performance claim drawn instead of written.
// ---------------------------------------------------------------

import { motion, useReducedMotion } from 'framer-motion'

import { cn } from '@/lib/cn'

interface Series {
  key: string
  label: string
  note: string
  color: string
  values: readonly number[]
}

/** Stacked bottom to top: what you own underneath, what you buy on top. */
const SERIES: readonly Series[] = [
  {
    key: 'owned',
    label: 'Owned',
    note: 'your site, your list',
    color: '#a8450e',
    values: [16, 17, 16, 18, 17, 19, 18, 20, 19, 21, 20, 22],
  },
  {
    key: 'shared',
    label: 'Shared',
    note: 'guests passing you on',
    color: '#dd6a16',
    values: [10, 12, 11, 14, 13, 15, 14, 16, 15, 17, 16, 18],
  },
  {
    key: 'earned',
    label: 'Earned',
    note: 'people talking about you',
    color: '#f0842f',
    values: [6, 7, 6, 8, 7, 9, 8, 10, 9, 11, 10, 12],
  },
  {
    key: 'paid',
    label: 'Paid',
    note: 'ads Ari runs for you',
    color: '#f9b27a',
    values: [12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16],
  },
]

const POINTS = SERIES[0].values.length
const HEADROOM = 72

/**
 * Band k's polygon: along the top of the running total including k, then back
 * along the total below it. Computed once at module load — the shape is fixed.
 */
function bandPath(index: number): string {
  const x = (i: number) => (i / (POINTS - 1)) * 100
  const y = (total: number) => 100 - (total / HEADROOM) * 100
  const sumTo = (i: number, upto: number) =>
    SERIES.slice(0, upto).reduce((acc, s) => acc + s.values[i], 0)

  const top: string[] = []
  const bottom: string[] = []
  for (let i = 0; i < POINTS; i += 1) {
    top.push(`${x(i)},${y(sumTo(i, index + 1))}`)
    bottom.unshift(`${x(i)},${y(sumTo(i, index))}`)
  }
  return `M${top.join(' L')} L${bottom.join(' L')} Z`
}

const PATHS = SERIES.map((_, i) => bandPath(i))

export function ReachMixCard({ className }: { className?: string }) {
  const reduced = useReducedMotion()

  return (
    <div className={cn('flex h-full flex-col gap-4', className)}>
      <div>
        <p className="font-dashboard text-[2rem] font-bold leading-none tracking-tight text-white tabular-nums">
          4 ways in
        </p>
        <p className="mt-1.5 font-dashboard text-[0.8125rem] text-white/55">
          Paid, earned, shared and owned · Ari works all four at once
        </p>
      </div>

      {/* Legend. Each channel says what it IS, not how it performed. */}
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{ background: s.color }}
            />
            <span className="min-w-0">
              <span className="block font-dashboard text-[0.8125rem] font-semibold text-white">
                {s.label}
              </span>
              <span className="block font-dashboard text-[0.6875rem] leading-tight text-white/45">
                {s.note}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <motion.div
        role="img"
        aria-label="The four ways people find a business on Mingla — owned, shared, earned and paid — stacked together, all running at once."
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg ring-1 ring-inset ring-white/10"
        style={{
          // The ruled grid the source card draws behind its chart.
          background:
            'linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px 100%) 0 0 / calc(100% / 6) 100% repeat no-repeat,' +
            'linear-gradient(180deg, rgba(255,255,255,0.07) 1px, transparent 1px 100%) 0 0 / 100% 25% no-repeat repeat',
        }}
        initial={reduced ? false : { clipPath: 'inset(0 100% 0 0)' }}
        whileInView={{ clipPath: 'inset(0 0% 0 0)' }}
        viewport={{ once: true, margin: '-40px' }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
      >
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {PATHS.map((d, i) => (
            <path key={SERIES[i].key} d={d} fill={SERIES[i].color} fillOpacity={0.9} />
          ))}
        </svg>
      </motion.div>
    </div>
  )
}
