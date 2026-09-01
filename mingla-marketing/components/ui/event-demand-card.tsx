'use client'

// ---------------------------------------------------------------
// #2902 — the Events figure: Mingla reading demand for a night.
//
// Adapted from a route-planner card whose good idea is the shape, not the
// subject: a warning up top, one number that matters, and a staggered bar
// graph that springs up from the floor. Here the graph is demand across the
// hours of a night rather than elevation across a ride, and the warning is the
// weather forecast the Events tool actually reads.
//
// The curve is HAND-AUTHORED, not random. The source card generated its bars
// with Math.random(), which would differ between the server and client render
// and trip hydration — and would make the figure a different shape on every
// load, which is not a figure, it is noise.
//
// Nothing here is a claim: no venue is named, and no figure is presented as a
// result anyone achieved.
//
// It leads with the peak WINDOW rather than a suggested price on purpose. The
// Host page is one static page serving London, the US and Lagos, and the
// marketing site has no geo signal at all -- so any price here would show one
// market's currency to all three. The window is the demand read itself, and it
// reads the same in every market.
// ---------------------------------------------------------------

import { motion, useReducedMotion } from 'framer-motion'
import { CloudRain } from 'lucide-react'

import { cn } from '@/lib/cn'

/** Half-hour buckets, 7pm through 4am. A night that builds late. */
const DEMAND = [
  0.18, 0.2, 0.24, 0.26, 0.31, 0.36, 0.4, 0.47, 0.55, 0.62,
  0.71, 0.8, 0.88, 0.95, 1.0, 0.97, 0.92, 0.84, 0.73, 0.6,
  0.48, 0.37, 0.28, 0.21,
] as const

/** The bars inside the peak window read brand; the rest stay quiet. */
const PEAK_FROM = 10
const PEAK_TO = 17

const HOURS = ['7pm', '10pm', '1am', '4am'] as const

export function EventDemandCard({ className }: { className?: string }) {
  const reduced = useReducedMotion()

  return (
    <div className={cn('flex h-full flex-col justify-center gap-3.5', className)}>
      {/* The weather read, which is a real Events feature and the reason the
          shape of the night moves. */}
      <motion.div
        initial={reduced ? false : { opacity: 0, y: -8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-40px' }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="flex items-center gap-2 rounded-xl bg-white/[0.07] px-3 py-2 ring-1 ring-inset ring-white/10"
      >
        <CloudRain className="h-4 w-4 shrink-0 text-[#f0842f]" aria-hidden="true" />
        <span className="font-dashboard text-[0.8125rem] font-medium text-white/80">
          Rain likely 7–9pm
        </span>
      </motion.div>

      <div>
        <p className="font-dashboard text-[2rem] font-bold leading-none tracking-tight text-white tabular-nums">
          10pm–1am
        </p>
        <p className="mt-1.5 font-dashboard text-[0.8125rem] text-white/55">
          Peak demand · Saturday night
        </p>
      </div>

      {/* The graph. Bars rise from the floor, staggered, so the curve draws
          itself left to right. overflow-hidden is what makes them rise FROM
          the baseline rather than slide around under it. */}
      <div
        role="img"
        aria-label="Forecast demand across the night, building from 7pm to a peak between 10pm and 1am, then tapering to 4am."
      >
        <motion.div
          className="flex h-14 w-full items-end gap-[2px] overflow-hidden"
          initial={reduced ? undefined : 'hidden'}
          whileInView={reduced ? undefined : 'visible'}
          viewport={{ once: true, margin: '-40px' }}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.022 } } }}
        >
          {DEMAND.map((height, i) => {
            const peak = i >= PEAK_FROM && i <= PEAK_TO
            return (
              <motion.span
                key={i}
                aria-hidden="true"
                className={cn('flex-1 rounded-t-[3px]', peak ? '' : 'bg-white/[0.16]')}
                style={{
                  height: `${height * 100}%`,
                  ...(peak
                    ? { background: 'linear-gradient(180deg, #f0842f 0%, #dd6a16 100%)' }
                    : null),
                }}
                variants={{
                  hidden: { y: '100%', opacity: 0 },
                  visible: {
                    y: '0%',
                    opacity: 1,
                    transition: { type: 'spring', stiffness: 120, damping: 14 },
                  },
                }}
              />
            )
          })}
        </motion.div>

        <div className="mt-2 flex justify-between font-dashboard text-[0.6875rem] text-white/40">
          {HOURS.map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
