'use client'
import { motion } from 'framer-motion'
import {
  CalendarCheck,
  UtensilsCrossed,
  Compass,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — business hero artifact.
//
// The business marketing hero must SHOW the business outcome, not the consumer
// swipe deck: money arriving across every category Mingla sells — event tickets,
// restaurant reservations, trip + experience bookings — with the headline "99%
// of earnings kept" payout summary on top. Amounts are illustrative examples
// (same posture as the ORCH-1007 marketing card decks), NOT account metrics.

const EASE = [0.16, 1, 0.3, 1] as const

interface BookingRow {
  icon: typeof CalendarCheck
  title: string
  meta: string
  amount: string
}

// Four bookings, one per Mingla category — the full experience economy, not
// just restaurant tables. Illustrative example values.
const BOOKINGS: BookingRow[] = [
  {
    icon: CalendarCheck,
    title: 'Rooftop Sessions — Sat',
    meta: 'Event · 2 tickets',
    amount: '+$90',
  },
  {
    icon: UtensilsCrossed,
    title: 'Table for 4 · 8:00 PM',
    meta: 'Reservation · confirmed',
    amount: '+$220',
  },
  {
    icon: Compass,
    title: 'Weekend Escape',
    meta: 'Trip · 2 guests',
    amount: '+$540',
  },
  {
    icon: Sparkles,
    title: 'Pasta-making class',
    meta: 'Experience · 2 seats',
    amount: '+$130',
  },
]

function BookingCard({ row, index, reduced }: { row: BookingRow; index: number; reduced: boolean }) {
  const Icon = row.icon
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: reduced ? 0 : 0.55 + index * 0.12, ease: EASE }}
      style={{ boxShadow: 'var(--elev-1)' }}
      className="flex items-center gap-3 rounded-2xl bg-white p-3.5"
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ background: 'var(--color-warm-tint)' }}
      >
        <Icon className="h-[18px] w-[18px]" style={{ color: 'var(--color-warm-ink)' }} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-display text-[15px] leading-tight text-text-primary">
          {row.title}
        </span>
        <span className="mt-0.5 truncate text-xs text-text-muted">{row.meta}</span>
      </span>
      <span
        className="ml-auto shrink-0 text-[15px] font-semibold tabular-nums"
        style={{ color: 'var(--color-success)' }}
      >
        {row.amount}
      </span>
    </motion.div>
  )
}

export function HeroBusinessCards({ className }: { className?: string }) {
  const reduced = useMinglaReducedMotion()

  return (
    <div className={cn('flex w-full max-w-sm flex-col gap-3', className)}>
      {/* Payout summary — the headline business outcome. */}
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: reduced ? 0 : 0.4, ease: EASE }}
        style={{ boxShadow: 'var(--elev-2)' }}
        className="rounded-2xl bg-white p-5"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
            Paid out this week
          </span>
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: 'rgba(63, 139, 92, 0.12)', color: 'var(--color-success)' }}
          >
            99% kept
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-display text-4xl leading-none tracking-[-0.01em] text-text-primary tabular-nums">
            $4,820
          </span>
          <span className="text-sm text-text-muted">straight to you</span>
        </div>
        <p className="mt-3 text-[13px] leading-snug text-text-secondary">
          Native checkout. No reservation fees, no ticket markup —{' '}
          <span style={{ color: 'var(--color-warm-ink)' }}>you keep what you earn.</span>
        </p>
      </motion.div>

      {/* Live booking feed — one per category. */}
      {BOOKINGS.map((row, i) => (
        <BookingCard key={row.title} row={row} index={i} reduced={reduced} />
      ))}
    </div>
  )
}
