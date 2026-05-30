'use client'
import {
  Ticket,
  CalendarCheck,
  UtensilsCrossed,
  Martini,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — Venues tab chart: a live "Your business, right now" feed. New
// activity arrives at the bottom and the list scrolls up continuously (vertical
// marquee on a doubled list — seamless loop, no per-item enter/exit jank).
// Venue-tailored: tables, tickets, reservations, check-ins, payouts. Illustrative.

type Tint = 'warm' | 'success'

interface FeedItem {
  icon: LucideIcon
  tint: Tint
  action: string
  subject: string
  meta: string
  amount?: string
}

const ITEMS: FeedItem[] = [
  { icon: UtensilsCrossed, tint: 'warm', action: 'New booking', subject: "Chef's table", meta: 'just now' },
  { icon: Ticket, tint: 'success', action: 'Ticket sold', subject: 'Rooftop Sessions', meta: 'just now', amount: '+$45' },
  { icon: CalendarCheck, tint: 'warm', action: 'Reservation', subject: 'Table for 6 · 8:30 PM', meta: '1m ago' },
  { icon: Martini, tint: 'success', action: 'Bottle service', subject: 'booked', meta: '2m ago', amount: '+$240' },
  { icon: Users, tint: 'warm', action: 'Check-in', subject: '4 guests arrived', meta: '3m ago' },
  { icon: Ticket, tint: 'success', action: 'Ticket sold', subject: 'Live jazz night', meta: '5m ago', amount: '+$38' },
  { icon: CalendarCheck, tint: 'warm', action: 'New booking', subject: 'Bowling lane · 2 hrs', meta: '7m ago', amount: '+$70' },
  { icon: UtensilsCrossed, tint: 'warm', action: 'Reservation', subject: 'Patio · golden hour', meta: '9m ago' },
  { icon: Wallet, tint: 'success', action: 'Payout sent', subject: '$1,240', meta: '12m ago' },
]

function Row({ it }: { it: FeedItem }) {
  const Icon = it.icon
  const tintBg = it.tint === 'success' ? 'rgba(63,139,92,0.12)' : 'var(--color-warm-tint)'
  const tintFg = it.tint === 'success' ? 'var(--color-success)' : 'var(--color-warm-ink)'
  return (
    <div className="flex items-center gap-3.5 border-t border-black/[0.06] px-6 py-3.5">
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ background: tintBg }}
      >
        <Icon className="h-[18px] w-[18px]" style={{ color: tintFg }} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-tight text-text-secondary">
          {it.action} — <span className="font-semibold text-text-primary">{it.subject}</span>
          {it.amount ? (
            <span className="ml-1.5 font-semibold" style={{ color: 'var(--color-success)' }}>
              {it.amount}
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-text-muted">{it.meta}</p>
      </div>
    </div>
  )
}

export function VenueActivityFeed() {
  const reduced = useMinglaReducedMotion()
  const loop = [...ITEMS, ...ITEMS]

  return (
    <div
      data-theme="light"
      className="font-dashboard w-full overflow-hidden rounded-2xl bg-white ring-1 ring-[rgba(14,14,16,0.05)]"
      style={{ boxShadow: 'var(--elev-3)' }}
    >
      <div className="flex items-center gap-2.5 px-6 pb-3 pt-6">
        <span className="relative inline-flex h-2.5 w-2.5">
          {!reduced ? (
            <span
              className="absolute inset-0 rounded-full"
              style={{ background: 'var(--color-success)', animation: 'mingla-chip-pulse 2s ease-in-out infinite' }}
            />
          ) : null}
          <span className="relative h-2.5 w-2.5 rounded-full" style={{ background: 'var(--color-success)' }} />
        </span>
        <span className="text-base font-bold text-text-primary">Your business, right now</span>
      </div>

      <div className="relative h-[424px] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,#000_7%,#000_90%,transparent)]">
        <div
          className="flex flex-col"
          style={{ animation: reduced ? undefined : 'mingla-marquee-y 26s linear infinite', willChange: 'transform' }}
        >
          {loop.map((it, i) => (
            <Row key={`${it.action}-${it.subject}-${i}`} it={it} />
          ))}
        </div>
      </div>
    </div>
  )
}
