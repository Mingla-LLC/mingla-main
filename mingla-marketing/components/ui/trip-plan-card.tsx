'use client'

// ---------------------------------------------------------------
// #2902 — the Trips figure: a trip as the group sees it.
//
// Takes the flight-search card's structure -- labelled value stacks, hairline
// rules between them, and the circular badge sitting on the divider -- and
// makes it a hosted trip rather than a flight lookup.
//
// The badge is ORNAMENT, not a control. In the source it swaps origin and
// destination; a hosted trip has no such action, and this whole card is a
// figure, so it is aria-hidden and does nothing.
//
// Route and instalment follow the visitor's market, same resolution as the
// Events price. Cities and regions only -- naming a real resort or operator
// would be a claim about their availability and price.
// ---------------------------------------------------------------

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { MoveDown, MoveRight } from 'lucide-react'

import { cn } from '@/lib/cn'
import type { HostImage } from '@/lib/design-preview/host-imagery'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { useActiveInViewport } from '@/lib/use-active-in-viewport'
import { DEFAULT_MARKET, TRIP_PLAN, detectMarket, type Market } from '@/lib/design-preview/market-price'

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="font-dashboard text-[0.6875rem] font-medium uppercase tracking-wide text-white/40">
        {label}
      </p>
      <p className="truncate font-dashboard text-[0.9375rem] font-semibold text-white">{value}</p>
    </div>
  )
}

function Rule() {
  return <div aria-hidden="true" className="my-2.5 h-px bg-white/10" />
}

/** The leading instalment count ("4 × $180" → 4); 0 when the value has none. */
function instalmentCount(value: string): number {
  const match = /^(\d+)\s*×/.exec(value)
  return match ? Math.min(Number(match[1]), 12) : 0
}

export function TripPlanCard({
  className,
  ambient = false,
  photo,
}: {
  className?: string
  /** #4137: instalment dots fill in sequence and the badge drifts, while on screen. */
  ambient?: boolean
  /** #4137: a travel photo behind the card, which floats over it. */
  photo?: HostImage
}) {
  const reduced = useMinglaReducedMotion()
  const { ref, active } = useActiveInViewport<HTMLDivElement>()

  // After mount, not during render: the server has no time zone, and reading
  // one during render would differ from the client's markup.
  const [market, setMarket] = useState<Market>(DEFAULT_MARKET)
  useEffect(() => setMarket(detectMarket()), [])
  const plan = TRIP_PLAN[market]
  const dots = instalmentCount(plan.instalment)

  const card = (
    <motion.div
      data-market={market}
      role="img"
      aria-label={`A hosted trip from ${plan.from} to ${plan.to}, 12 to 14 September, six travelling, paid in instalments of ${plan.instalment}.`}
      initial={reduced ? false : { opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'cut-host-trip-figure',
        photo
          ? 'rounded-xl bg-[rgba(20,18,15,0.82)] p-3.5 ring-1 ring-inset ring-white/10 backdrop-blur-md'
          : 'rounded-xl bg-white/[0.05] p-4 ring-1 ring-inset ring-white/10',
        !photo && className,
      )}
    >
      {photo ? (
        // #4137: over a photo the route sits on one row, so the card stays
        // compact enough to leave the photo visible above it.
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          <Field label="From" value={plan.from} />
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white"
            style={{
              background: 'linear-gradient(180deg, #f0842f 0%, #dd6a16 100%)',
              boxShadow: '0 -2px 0 0 #a8450e inset, 0 1px 0 0 rgba(255,255,255,0.3) inset',
            }}
          >
            <MoveRight className="cut-amb-fly h-4 w-4" strokeWidth={2.4} />
          </span>
          <Field label="To" value={plan.to} className="text-right" />
        </div>
      ) : (
        <div className="relative">
          <Field label="From" value={plan.from} />
          <Rule />
          <Field label="To" value={plan.to} />

          {/* The badge that sits on the divider. Ornament only. */}
          <span
            aria-hidden="true"
            className="absolute right-0 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-white"
            style={{
              background: 'linear-gradient(180deg, #f0842f 0%, #dd6a16 100%)',
              boxShadow: '0 -2px 0 0 #a8450e inset, 0 1px 0 0 rgba(255,255,255,0.3) inset',
            }}
          >
            <MoveDown className="cut-amb-fly h-4 w-4" strokeWidth={2.4} />
          </span>
        </div>
      )}

      <Rule />

      <div className="grid grid-cols-3 gap-3">
        <Field label="Leaves" value="12 Sep" />
        <Field label="Returns" value="14 Sep" />
        <Field label="Group" value="6" />
      </div>

      <Rule />

      <div className="flex items-end gap-3">
        <Field label="Instalments" value={plan.instalment} />
        {dots > 0 ? (
          <span aria-hidden="true" className="mb-[5px] flex gap-1">
            {Array.from({ length: dots }, (_, i) => (
              <i key={i} className="cut-amb-dot block h-2.5 w-2.5 rounded-full" />
            ))}
          </span>
        ) : null}
      </div>
    </motion.div>
  )

  const ambientState = ambient && !reduced && active ? 'on' : 'off'

  if (!photo) {
    return (
      <div ref={ref} data-ambient={ambientState}>
        {card}
      </div>
    )
  }

  // #4137: the photo sits behind; the card floats over its lower part. The
  // card stays in flow, so the tile grows with it and nothing is clipped.
  return (
    <div
      ref={ref}
      data-ambient={ambientState}
      className={cn('relative overflow-hidden rounded-[18px] px-2.5 pb-2.5 pt-24', className)}
    >
      <Image
        src={photo.file}
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
        sizes="(min-width: 1024px) 30vw, 90vw"
        loading="lazy"
        className="absolute inset-x-0 top-0 h-[240px] w-full object-cover"
      />
      <div className="relative">{card}</div>
    </div>
  )
}
