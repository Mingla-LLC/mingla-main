'use client'
import { useState, useEffect, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CalendarCheck, Ticket, Wallet, Mail, UserPlus, type LucideIcon } from 'lucide-react'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { cn } from '@/lib/cn'

// ORCH-1010 — adapted from 21st.dev RecentActivityFeed (uniquesonu) into a
// "Your business, right now" live feed. Dashboard font (Inter), warm light
// theme. All items are ILLUSTRATIVE Mingla mockups (ORCH-1007 reality-anchor) —
// the kinds of events a real organiser sees (bookings, ticket sales, payouts,
// email-blast opens, new followers), not live/fabricated account metrics.
// Dropped: shadcn Card/Separator, blue/purple/green-shadcn icon chips, dark.
// Kept: framer enter/exit + the "new item appears at top" loop (reduced-motion
// gated → static list, no auto-play, when the user prefers reduced motion).

type Tone = 'warm' | 'success'

interface FeedItem {
  id: string
  icon: LucideIcon
  message: ReactNode
  timestamp: string
  tone: Tone
}

const TONE_CHIP: Record<Tone, string> = {
  warm: 'text-warm-ink bg-warm/10',
  success: 'text-[var(--color-success)] bg-[rgba(63,139,92,0.10)]',
}

// The steady-state feed (newest first).
const BASE_ITEMS: FeedItem[] = [
  {
    id: 'booking',
    icon: CalendarCheck,
    message: (
      <>
        New booking — <span className="font-semibold text-text-primary">Table for 4</span>
      </>
    ),
    timestamp: 'just now',
    tone: 'warm',
  },
  {
    id: 'ticket',
    icon: Ticket,
    message: (
      <>
        Ticket sold — Rooftop Sessions{' '}
        <span className="font-semibold text-[var(--color-success)]">+$45</span>
      </>
    ),
    timestamp: '2m ago',
    tone: 'success',
  },
  {
    id: 'payout',
    icon: Wallet,
    message: (
      <>
        Payout sent — <span className="font-semibold text-text-primary">$1,240</span>
      </>
    ),
    timestamp: '12m ago',
    tone: 'success',
  },
  {
    id: 'email',
    icon: Mail,
    message: (
      <>
        Email blast opened by <span className="font-semibold text-text-primary">312 people</span>
      </>
    ),
    timestamp: '1h ago',
    tone: 'warm',
  },
  {
    id: 'follower',
    icon: UserPlus,
    message: (
      <>
        New follower — <span className="font-semibold text-text-primary">@maya</span>
      </>
    ),
    timestamp: '1h ago',
    tone: 'warm',
  },
]

// Items that cycle in at the top to simulate live activity (motion only).
const INCOMING: FeedItem[] = [
  {
    id: 'live-ticket',
    icon: Ticket,
    message: (
      <>
        Ticket sold — Sunset Sail{' '}
        <span className="font-semibold text-[var(--color-success)]">+$38</span>
      </>
    ),
    timestamp: 'just now',
    tone: 'success',
  },
  {
    id: 'live-booking',
    icon: CalendarCheck,
    message: (
      <>
        New booking — <span className="font-semibold text-text-primary">Chef&rsquo;s table</span>
      </>
    ),
    timestamp: 'just now',
    tone: 'warm',
  },
]

export function LiveActivityFeed() {
  const reduced = useMinglaReducedMotion()
  const [items, setItems] = useState<FeedItem[]>(BASE_ITEMS)

  useEffect(() => {
    if (reduced) return
    let tick = 0
    const interval = setInterval(() => {
      const incoming = INCOMING[tick % INCOMING.length]
      tick += 1
      setItems((prev) => {
        const fresh: FeedItem = { ...incoming, id: `${incoming.id}-${tick}` }
        return [fresh, ...prev].slice(0, 5)
      })
    }, 3800)
    return () => clearInterval(interval)
  }, [reduced])

  const itemVariants = {
    hidden: { opacity: 0, y: -10, filter: 'blur(3px)' },
    visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.32, ease: 'easeOut' as const } },
    exit: { opacity: 0, x: -16, transition: { duration: 0.2, ease: 'easeIn' as const } },
  }

  return (
    <div
      className="font-dashboard w-full overflow-hidden rounded-2xl bg-white ring-1 ring-[rgba(14,14,16,0.05)]"
      style={{ boxShadow: 'var(--elev-3)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5 md:px-6">
        <span className="relative flex size-2.5">
          {!reduced && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-success)] opacity-60" />
          )}
          <span className="relative inline-flex size-2.5 rounded-full bg-[var(--color-success)]" />
        </span>
        <h3 className="text-base font-semibold text-text-primary">Your business, right now</h3>
      </div>

      <div className="divide-y divide-[rgba(14,14,16,0.05)]">
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const Icon = item.icon
            const body = (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-9 flex-shrink-0 items-center justify-center rounded-full',
                    TONE_CHIP[item.tone],
                  )}
                >
                  <Icon className="size-4" strokeWidth={2} />
                </span>
                <div className="flex min-w-0 flex-grow flex-col">
                  <p className="text-sm leading-snug text-text-secondary">{item.message}</p>
                  <p className="mt-0.5 text-xs text-text-muted">{item.timestamp}</p>
                </div>
              </>
            )
            if (reduced) {
              return (
                <div key={item.id} className="flex items-start gap-3 px-5 py-3.5 md:px-6">
                  {body}
                </div>
              )
            }
            return (
              <motion.div
                key={item.id}
                variants={itemVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                layout
                className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-warm/[0.03] md:px-6"
              >
                {body}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
