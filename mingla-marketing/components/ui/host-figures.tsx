'use client'

// ---------------------------------------------------------------
// #2902 — the figures inside the Host bento cards.
//
// One grammar, shared with the Events card: a headline that is the single
// number worth reading, a quiet line under it, and one piece of geometry that
// draws itself in on scroll. No figure carries a metric anyone could mistake
// for a result — these show what the tool DOES, not how it performed.
//
// Every value is hand-authored and stable. Nothing here is random: a figure
// that changes shape on reload is not a figure.
// ---------------------------------------------------------------

import type { ComponentType, ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

import { cn } from '@/lib/cn'
import { EventDemandCard } from '@/components/ui/event-demand-card'
import { TripPlanCard } from '@/components/ui/trip-plan-card'
import { ReachMixCard } from '@/components/ui/reach-mix-card'

const EASE = [0.16, 1, 0.3, 1] as const
const VIEWPORT = { once: true, margin: '-40px' } as const
const BRAND = 'linear-gradient(180deg, #f0842f 0%, #dd6a16 100%)'

function Figure({
  headline,
  sub,
  children,
}: {
  headline: string
  sub: string
  children: ReactNode
}) {
  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <p className="font-dashboard text-[2rem] font-bold leading-none tracking-tight text-white tabular-nums">
          {headline}
        </p>
        <p className="mt-1.5 font-dashboard text-[0.8125rem] text-white/55">{sub}</p>
      </div>
      {children}
    </div>
  )
}

// --- Venue: tonight's floor, as a room of tables. ---------------------------

const VENUE_COLS = 8
const VENUE_TOTAL = 24
const VENUE_BOOKED = 18

function VenueFigure() {
  const reduced = useReducedMotion()
  return (
    <Figure headline={`${VENUE_BOOKED} of ${VENUE_TOTAL} tables`} sub="Tonight · the 8pm sitting">
      <motion.div
        className="grid max-w-[16rem] gap-1.5"
        style={{ gridTemplateColumns: `repeat(${VENUE_COLS}, minmax(0, 1fr))` }}
        role="img"
        aria-label={`A floor of ${VENUE_TOTAL} tables with ${VENUE_BOOKED} booked for tonight.`}
        initial={reduced ? undefined : 'hidden'}
        whileInView={reduced ? undefined : 'visible'}
        viewport={VIEWPORT}
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.018 } } }}
      >
        {Array.from({ length: VENUE_TOTAL }, (_, i) => {
          const booked = i < VENUE_BOOKED
          return (
            <motion.span
              key={i}
              aria-hidden="true"
              className={cn(
                'aspect-square rounded-[4px]',
                !booked && 'bg-white/[0.10] ring-1 ring-inset ring-white/15',
              )}
              style={booked ? { background: BRAND } : undefined}
              variants={{
                hidden: { scale: 0.4, opacity: 0 },
                visible: {
                  scale: 1,
                  opacity: 1,
                  transition: { type: 'spring', stiffness: 260, damping: 18 },
                },
              }}
            />
          )
        })}
      </motion.div>
    </Figure>
  )
}

// --- Marketing: who one send reaches. ---------------------------------------
//
// Proportions only, deliberately. Put open rates or audience counts here and
// the figure stops describing the tool and starts claiming a result.

const AUDIENCES = [
  { label: 'Came before', pct: 34 },
  { label: "Looked, didn't book", pct: 61 },
  { label: 'Never heard of you', pct: 100 },
] as const

function MarketingFigure() {
  const reduced = useReducedMotion()
  return (
    <div className="flex h-full flex-col justify-center">
      <motion.div
        className="flex flex-col gap-2.5"
        role="img"
        aria-label="Three audiences one send reaches: past guests, people who looked but did not book, and people nearby who have never heard of you."
        initial={reduced ? undefined : 'hidden'}
        whileInView={reduced ? undefined : 'visible'}
        viewport={VIEWPORT}
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.1 } } }}
      >
        {AUDIENCES.map((a, i) => (
          <div key={a.label} className="flex items-center gap-2.5">
            <span className="w-[7.5rem] shrink-0 font-dashboard text-[0.6875rem] text-white/55">
              {a.label}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.09]">
              <motion.span
                aria-hidden="true"
                className="block h-full rounded-full"
                style={{
                  width: `${a.pct}%`,
                  background: i === AUDIENCES.length - 1 ? BRAND : 'rgba(255,255,255,0.28)',
                  transformOrigin: 'left',
                }}
                variants={{
                  hidden: { scaleX: 0 },
                  visible: { scaleX: 1, transition: { duration: 0.6, ease: EASE } },
                }}
              />
            </span>
          </div>
        ))}
      </motion.div>
    </div>
  )
}

const FIGURES: Record<string, ComponentType> = {
  events: EventDemandCard,
  trips: TripPlanCard,
  venue: VenueFigure,
  marketing: MarketingFigure,
  brain: ReachMixCard,
}

export function HostFigure({ id }: { id: string }) {
  const Component = FIGURES[id]
  return Component ? <Component /> : null
}
