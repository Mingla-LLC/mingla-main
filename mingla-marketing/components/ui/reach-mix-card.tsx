'use client'

// ---------------------------------------------------------------
// #2902 — the AI brain figure: customers over time, with Ari and without.
//
// Paid, earned, shared and owned, stacked and growing across a year, against a
// flat dashed baseline for what the same business does without Mingla.
//
// Drawn as inline SVG: the original is a recharts AreaChart, and pulling
// recharts plus next-themes into the marketing bundle to decorate one card is
// not a trade worth making. Polygons and a clip reveal do the same job.
//
// NO headline or sub-line here. The card already renders a title and a body
// above this; the figure repeating them read as two headings and two
// descriptions stacked on each other.
//
// The axes carry no numbers, and there is no percentage, count or trend badge
// -- the source card leads on "16.9%" and "+2.1%", which would be exactly the
// fabricated performance claim this pass is under orders to avoid. The shape
// is illustrative: what the four channels are, and that they compound.
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
    values: [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26],
  },
  {
    key: 'shared',
    label: 'Shared',
    note: 'guests passing you on',
    color: '#dd6a16',
    values: [2, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 22],
  },
  {
    key: 'earned',
    label: 'Earned',
    note: 'people talking about you',
    color: '#f0842f',
    values: [1, 2, 3, 4, 6, 7, 9, 10, 12, 14, 15, 16],
  },
  {
    key: 'paid',
    label: 'Paid',
    note: 'ads Ari runs for you',
    color: '#f9b27a',
    values: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  },
]

/** The same business, same year, without any of it working for them. */
const WITHOUT = 12

const POINTS = SERIES[0].values.length
const HEADROOM = 84

const x = (i: number) => (i / (POINTS - 1)) * 100
const y = (total: number) => 100 - (total / HEADROOM) * 100
const sumTo = (i: number, upto: number) =>
  SERIES.slice(0, upto).reduce((acc, s) => acc + s.values[i], 0)

/** Band k: along the top of the running total including k, back along the one below. */
function bandPath(index: number): string {
  const top: string[] = []
  const bottom: string[] = []
  for (let i = 0; i < POINTS; i += 1) {
    top.push(`${x(i)},${y(sumTo(i, index + 1))}`)
    bottom.unshift(`${x(i)},${y(sumTo(i, index))}`)
  }
  return `M${top.join(' L')} L${bottom.join(' L')} Z`
}

const PATHS = SERIES.map((_, i) => bandPath(i))
const WITHOUT_Y = y(WITHOUT)

export function ReachMixCard({ className }: { className?: string }) {
  const reduced = useReducedMotion()

  return (
    <div className={cn('flex h-full flex-col gap-3', className)}>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
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
        <li className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-[9px] h-0 w-2.5 shrink-0 border-t-2 border-dashed border-white/45"
          />
          <span className="min-w-0">
            <span className="block font-dashboard text-[0.8125rem] font-semibold text-white/70">
              Without Mingla
            </span>
            <span className="block font-dashboard text-[0.6875rem] leading-tight text-white/45">
              the same year, on your own
            </span>
          </span>
        </li>
      </ul>

      <div className="flex min-h-0 flex-1 flex-col">
        <p className="mb-1 font-dashboard text-[0.6875rem] font-medium uppercase tracking-wide text-white/40">
          Customers
        </p>

        <motion.div
          role="img"
          aria-label="Customers over a year. Without Mingla the line stays flat. With Mingla, four channels — owned, shared, earned and paid — stack up and keep growing."
          className="relative min-h-[5rem] flex-1 overflow-hidden rounded-lg ring-1 ring-inset ring-white/10"
          style={{
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
              <path key={SERIES[i].key} d={d} fill={SERIES[i].color} fillOpacity={0.92} />
            ))}
            {/* Without Mingla: flat, and the bands leave it behind.
                vectorEffect keeps the dash even under the non-uniform scale. */}
            <path
              d={`M0,${WITHOUT_Y} L100,${WITHOUT_Y}`}
              stroke="rgba(255,255,255,0.55)"
              strokeWidth={2}
              strokeDasharray="5 4"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </motion.div>

        <div className="mt-1.5 flex justify-between font-dashboard text-[0.6875rem] text-white/40">
          <span>Month 1</span>
          <span>Month 12</span>
        </div>
      </div>
    </div>
  )
}
