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
//
// #4137 — CONSTITUTION RULE 9 (no fabricated data). The values below are the
// ones live /host already showed: 18 of 24 tables, the 34 / 61 / 100 audience
// proportions, and (in the Trips card) the market's own route and instalment.
// The redesign mockup's "London → Paris", "4 payments", 44 / 62 / 86% bars,
// "Fri 9 Nov / 8:30pm / 4 guests" and "Email · Thursday 5pm" were REJECTED:
// they are numbers the page never showed. The redesign adds photos and
// `ambient` motion (on only while the tile is on screen, never under reduced
// motion, and off by default so /internal/charts is unchanged) — not values.
// ---------------------------------------------------------------

import type { ComponentType, ReactNode } from 'react'
import Image from 'next/image'
import { motion, useReducedMotion } from 'framer-motion'

import { cn } from '@/lib/cn'
import type { HostImage } from '@/lib/design-preview/host-imagery'
import { useActiveInViewport } from '@/lib/use-active-in-viewport'
import { EventDemandCard } from '@/components/ui/event-demand-card'
import { TripPlanCard } from '@/components/ui/trip-plan-card'
import { ReachMixCard } from '@/components/ui/reach-mix-card'

const EASE = [0.16, 1, 0.3, 1] as const
const VIEWPORT = { once: true, margin: '-40px' } as const
const BRAND = 'linear-gradient(180deg, #f0842f 0%, #dd6a16 100%)'

/** Props every figure accepts (#4137). */
export interface FigureProps {
  ambient?: boolean
  photo?: HostImage
}

/** #4137: ambient motion runs only when asked for, allowed, and on screen. */
function useAmbient(ambient: boolean) {
  const reduced = useReducedMotion()
  const { ref, active } = useActiveInViewport<HTMLDivElement>()
  return { ref, state: ambient && !reduced && active ? 'on' : 'off' } as const
}

function Figure({
  headline,
  sub,
  photo,
  children,
}: {
  headline: string
  sub: string
  photo?: HostImage
  children: ReactNode
}) {
  return (
    <div className="flex h-full flex-col gap-4">
      {/* #4137: with a photo, the sub-line becomes a tag on the photo. */}
      {photo ? (
        <div className="relative overflow-hidden rounded-2xl">
          <Image
            src={photo.file}
            alt={photo.alt}
            width={photo.width}
            height={photo.height}
            sizes="(min-width: 1024px) 30vw, 90vw"
            loading="lazy"
            className="block h-[120px] w-full object-cover"
          />
          <span className="absolute bottom-2 left-2 rounded-full bg-[rgba(20,18,15,0.78)] px-2.5 py-0.5 font-dashboard text-[0.75rem] font-bold text-white">
            {sub}
          </span>
        </div>
      ) : null}
      <div>
        <p className="font-dashboard text-[2rem] font-bold leading-none tracking-tight text-white tabular-nums">
          {headline}
        </p>
        {photo ? null : <p className="mt-1.5 font-dashboard text-[0.8125rem] text-white/55">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

// --- Venue: tonight's floor, as a room of tables. ---------------------------

const VENUE_COLS = 8
const VENUE_TOTAL = 24
const VENUE_BOOKED = 18

export function VenueFigure({ ambient = false, photo }: FigureProps = {}) {
  const reduced = useReducedMotion()
  const amb = useAmbient(ambient)
  return (
    <div ref={amb.ref} data-ambient={amb.state} className="h-full">
    <Figure headline={`${VENUE_BOOKED} of ${VENUE_TOTAL} tables`} sub="Tonight · the 8pm sitting" photo={photo}>
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
              className="flex aspect-square"
              variants={{
                hidden: { scale: 0.4, opacity: 0 },
                visible: {
                  scale: 1,
                  opacity: 1,
                  transition: { type: 'spring', stiffness: 260, damping: 18 },
                },
              }}
            >
              {/* Inner span: booked tables pulse (#4137) without touching the entrance. */}
              <span
                className={cn(
                  'flex-1 rounded-[4px]',
                  booked ? 'cut-amb-seat' : 'bg-white/[0.10] ring-1 ring-inset ring-white/15',
                )}
                style={booked ? { background: BRAND } : undefined}
              />
            </motion.span>
          )
        })}
      </motion.div>
    </Figure>
    </div>
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

export function MarketingFigure({ ambient = false, photo }: FigureProps = {}) {
  const reduced = useReducedMotion()
  const amb = useAmbient(ambient)
  return (
    <div ref={amb.ref} data-ambient={amb.state} className="flex h-full flex-col justify-center gap-4">
      {/* #4137: an email preview row. The subject carries no date or number. */}
      {photo ? (
        <div className="flex items-center gap-2.5 rounded-[14px] bg-[#fffdf9] p-2 text-[var(--cut-ink,#14120f)]">
          <Image
            src={photo.file}
            alt={photo.alt}
            width={64}
            height={48}
            sizes="64px"
            loading="lazy"
            className="h-12 w-16 shrink-0 rounded-[10px] object-cover"
          />
          <div className="min-w-0">
            <p className="font-dashboard text-[0.6875rem] font-bold text-[#6b6157]">Email</p>
            <p className="truncate font-dashboard text-[0.875rem] font-bold text-[#14120f]">Your table&rsquo;s ready this Friday</p>
          </div>
        </div>
      ) : null}
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
                className="flex h-full"
                style={{ width: `${a.pct}%`, transformOrigin: 'left' }}
                variants={{
                  hidden: { scaleX: 0 },
                  visible: { scaleX: 1, transition: { duration: 0.6, ease: EASE } },
                }}
              >
                {/* Inner span: the ambient grow loop (#4137), apart from the entrance. */}
                <span
                  className="cut-amb-grow block h-full flex-1 rounded-full"
                  style={{ background: i === AUDIENCES.length - 1 ? BRAND : 'rgba(255,255,255,0.28)' }}
                />
              </motion.span>
            </span>
          </div>
        ))}
      </motion.div>
    </div>
  )
}

const FIGURES: Record<string, ComponentType<FigureProps>> = {
  events: EventDemandCard,
  trips: TripPlanCard,
  venue: VenueFigure,
  marketing: MarketingFigure,
  brain: ReachMixCard,
}

/**
 * `ambient` defaults to false, so /internal/charts (chart-bank.tsx) renders the
 * figures exactly as before; /host opts in per tile (#4137).
 */
export function HostFigure({ id, ambient = false, photo }: { id: string } & FigureProps) {
  const Component = FIGURES[id]
  return Component ? <Component ambient={ambient} photo={photo} /> : null
}
