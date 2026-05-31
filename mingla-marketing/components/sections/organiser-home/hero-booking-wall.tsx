'use client'
import { Wine, Coffee, Music, Sparkles, UtensilsCrossed, PartyPopper, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

// ORCH-1010 — hero "3D booking wall".
//
// A tilted 3D marquee of booking moments (adapted from the 3D-testimonials
// pattern) used as the full-bleed BACKGROUND of the business hero, behind a dark
// overlay. Each card is a real-feeling booking themed by a vibe — restaurants,
// cafés, events, clubs, tables — to show the demand Mingla creates. Illustrative
// content (ORCH-1007 posture), not real users. Columns scroll vertically via the
// `mingla-marquee-y` keyframe; reduced-motion freezes it into a static wall.

interface Booking {
  name: string
  handle: string
  vibe: string
  action: string
  venue: string
  icon: LucideIcon
}

const C1: Booking[] = [
  { name: 'Maya', handle: '@maya', vibe: 'date night', action: 'Booked a rooftop table for two', venue: 'Solas Rooftop', icon: Wine },
  { name: 'Deji', handle: '@dej', vibe: 'turn up', action: 'Got 6 of us a table at the club', venue: 'Quilox · Fri', icon: PartyPopper },
  { name: 'Sara', handle: '@sara_k', vibe: 'slow morning', action: 'Found a jazz café for Sunday', venue: 'Blue Note Café', icon: Coffee },
  { name: 'Tomi', handle: '@tomiii', vibe: 'foodie', action: "Reserved the chef's counter", venue: 'Nok by Alara', icon: UtensilsCrossed },
]

const C2: Booking[] = [
  { name: 'Liv', handle: '@livr', vibe: 'link up', action: 'Grabbed afrobeats night tickets', venue: 'Rooftop Sessions', icon: Music },
  { name: 'Noah', handle: '@noah', vibe: 'celebration', action: 'Bottle service for the birthday', venue: 'Cirque · Sat', icon: Sparkles },
  { name: 'Ada', handle: '@adaa', vibe: 'cozy', action: 'Cosy wine bar, just the two of us', venue: 'Vines Wine Bar', icon: Wine },
  { name: 'Kai', handle: '@kai', vibe: 'group hang', action: 'Brunch table for the whole crew', venue: 'RSVP Lagos', icon: Coffee },
]

const C3: Booking[] = [
  { name: 'Zara', handle: '@zar', vibe: 'golden hour', action: 'Sunset cocktails, front table', venue: 'Bature Brewery', icon: Wine },
  { name: 'Femi', handle: '@femi', vibe: 'live music', action: 'Live band night, two seats', venue: 'Jazzhole', icon: Music },
  { name: 'Remi', handle: '@remi', vibe: 'after hours', action: 'Late-night spot, table for 4', venue: 'Sip & Savor', icon: UtensilsCrossed },
  { name: 'Ola', handle: '@ola', vibe: 'first date', action: 'Quiet dinner, window table', venue: 'Terra Kulture', icon: UtensilsCrossed },
]

function BookingCard({ b }: { b: Booking }) {
  const Icon = b.icon
  return (
    <div className="w-[280px] rounded-2xl bg-white/95 p-4 shadow-lg ring-1 ring-black/5 backdrop-blur-sm">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
          style={{ background: 'var(--color-warm-tint)', color: 'var(--color-warm-ink)' }}
        >
          {b.name.charAt(0)}
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[13px] font-semibold text-text-primary">{b.name}</span>
          <span className="text-[11px] text-text-muted">{b.handle}</span>
        </span>
        <span
          className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold lowercase"
          style={{ background: 'var(--color-warm-tint)', color: 'var(--color-warm-ink)' }}
        >
          {b.vibe}
        </span>
      </div>
      <p className="mt-3 text-[14px] font-medium leading-snug text-text-primary">{b.action}</p>
      <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-text-muted">
        <Icon className="h-3.5 w-3.5" style={{ color: 'var(--color-warm-ink)' }} />
        <span>{b.venue}</span>
      </div>
    </div>
  )
}

function Column({ items, duration, reverse }: { items: Booking[]; duration: number; reverse?: boolean }) {
  const doubled = [...items, ...items]
  return (
    <div className="relative h-full w-[280px] shrink-0 overflow-hidden">
      <div
        className="flex flex-col gap-4"
        style={{
          animation: `mingla-marquee-y ${duration}s linear infinite${reverse ? ' reverse' : ''}`,
          willChange: 'transform',
        }}
      >
        {doubled.map((b, i) => (
          <BookingCard key={`${b.handle}-${i}`} b={b} />
        ))}
      </div>
    </div>
  )
}

export function HeroBookingWall({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      style={{ perspective: '1400px' }}
    >
      <div
        className="absolute left-1/2 top-1/2 flex gap-5"
        style={{
          height: '170%',
          transform: 'translate(-50%, -50%) rotateX(20deg) rotateZ(-14deg) scale(1.35)',
          transformOrigin: 'center',
        }}
      >
        <Column items={C1} duration={34} />
        <Column items={C2} duration={44} reverse />
        <Column items={C3} duration={38} />
      </div>
    </div>
  )
}
