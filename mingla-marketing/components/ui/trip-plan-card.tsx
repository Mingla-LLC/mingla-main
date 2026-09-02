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
import { motion, useReducedMotion } from 'framer-motion'
import { MoveDown } from 'lucide-react'

import { cn } from '@/lib/cn'
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

export function TripPlanCard({ className }: { className?: string }) {
  const reduced = useReducedMotion()

  // After mount, not during render: the server has no time zone, and reading
  // one during render would differ from the client's markup.
  const [market, setMarket] = useState<Market>(DEFAULT_MARKET)
  useEffect(() => setMarket(detectMarket()), [])
  const plan = TRIP_PLAN[market]

  return (
    <motion.div
      data-market={market}
      role="img"
      aria-label={`A hosted trip from ${plan.from} to ${plan.to}, 12 to 14 September, six travelling, paid in instalments of ${plan.instalment}.`}
      initial={reduced ? false : { opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'rounded-xl bg-white/[0.05] p-4 ring-1 ring-inset ring-white/10',
        className,
      )}
    >
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
          <MoveDown className="h-4 w-4" strokeWidth={2.4} />
        </span>
      </div>

      <Rule />

      <div className="grid grid-cols-3 gap-3">
        <Field label="Leaves" value="12 Sep" />
        <Field label="Returns" value="14 Sep" />
        <Field label="Group" value="6" />
      </div>

      <Rule />

      <Field label="Instalments" value={plan.instalment} />
    </motion.div>
  )
}
