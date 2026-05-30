'use client'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Wallet,
  CalendarCheck,
  Users,
  Send,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — business hero artifact (v2).
//
// A staircase deck of landscape "dashboard" cards that climbs vertically and
// gently shuffles, each card a mini growth-OS surface: payouts (99% kept),
// bookings across every category, CRM, blasts + email outreach, and AI
// advertising that fills slow days. Corner chips fade in/out cycling the
// options. All values are illustrative product mockups (ORCH-1007 posture) —
// NOT live account data, NOT stock art.

const EASE = [0.16, 1, 0.3, 1] as const

type Viz = 'bars' | 'cats' | 'avatars' | 'progress' | 'spark'

interface CapCard {
  id: string
  icon: LucideIcon
  title: string
  metric: string
  metricSuffix?: string
  sub: string
  badge?: string
  chips: string[]
  viz: Viz
}

const CARDS: CapCard[] = [
  {
    id: 'payouts',
    icon: Wallet,
    title: 'Payouts',
    metric: '$4,820',
    metricSuffix: 'this week',
    sub: 'Native checkout — no markup.',
    badge: '99% kept',
    chips: ['Instant', 'No fees', 'Receipts'],
    viz: 'bars',
  },
  {
    id: 'bookings',
    icon: CalendarCheck,
    title: 'Bookings',
    metric: '128',
    metricSuffix: 'this week',
    sub: 'Tickets, tables, trips & seats.',
    chips: ['Events', 'Reservations', 'Trips', 'Experiences'],
    viz: 'cats',
  },
  {
    id: 'crm',
    icon: Users,
    title: 'Your customers',
    metric: '1,240',
    metricSuffix: 'owned',
    sub: 'Every buyer, tagged & yours.',
    chips: ['Tagged', 'Segments', 'Repeat guests'],
    viz: 'avatars',
  },
  {
    id: 'blasts',
    icon: Send,
    title: 'Blasts & outreach',
    metric: '3,200',
    metricSuffix: 'reached',
    sub: 'Email your real buyers in a tap.',
    badge: '31% opened',
    chips: ['Email', 'Outreach', 'Re-engage'],
    viz: 'progress',
  },
  {
    id: 'ai-ads',
    icon: Sparkles,
    title: 'AI advertising',
    metric: '+40',
    metricSuffix: 'seats, Tue',
    sub: 'Fills your slow days automatically.',
    badge: 'Foot traffic',
    chips: ['Slow days', 'Auto-optimised', 'On-app reach'],
    viz: 'spark',
  },
]

// ---- mini dashboard visualizations (pure markup, no images) ---------------

function Bars() {
  const h = [40, 64, 52, 78, 60, 92, 70]
  return (
    <div className="flex h-9 items-end gap-1.5">
      {h.map((v, i) => (
        <span
          key={i}
          className="w-2 flex-1 rounded-full"
          style={{
            height: `${v}%`,
            background:
              i === 5
                ? 'var(--color-warm)'
                : 'color-mix(in srgb, var(--color-warm) 28%, transparent)',
          }}
        />
      ))}
    </div>
  )
}

function Cats() {
  const cats = [
    { label: 'Events', v: 52 },
    { label: 'Tables', v: 78 },
    { label: 'Trips', v: 34 },
    { label: 'Exp.', v: 60 },
  ]
  return (
    <div className="flex flex-col gap-1.5">
      {cats.map((c) => (
        <div key={c.label} className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-[10px] text-text-muted">{c.label}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/5">
            <span
              className="block h-full rounded-full"
              style={{ width: `${c.v}%`, background: 'var(--color-warm)' }}
            />
          </span>
        </div>
      ))}
    </div>
  )
}

function Avatars() {
  return (
    <div className="flex items-center">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="-ml-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold first:ml-0"
          style={{
            background: `color-mix(in srgb, var(--color-warm) ${18 + i * 12}%, white)`,
            color: 'var(--color-warm-ink)',
          }}
        >
          {['A', 'M', 'J', 'K', 'R'][i]}
        </span>
      ))}
      <span className="ml-2 text-[11px] font-medium text-text-muted">+1.2k</span>
    </div>
  )
}

function ProgressViz() {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[10px] text-text-muted">
        <span>Delivered</span>
        <span>Opened</span>
      </div>
      <span className="h-2 overflow-hidden rounded-full bg-black/5">
        <span
          className="block h-full rounded-full"
          style={{ width: '64%', background: 'var(--color-warm)' }}
        />
      </span>
    </div>
  )
}

function Spark() {
  return (
    <svg viewBox="0 0 120 36" className="h-9 w-full" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points="0,30 18,28 34,30 52,22 70,24 88,12 104,8 120,4"
        fill="none"
        stroke="var(--color-warm)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="120" cy="4" r="3.5" fill="var(--color-warm)" />
    </svg>
  )
}

function Viz({ kind }: { kind: Viz }) {
  switch (kind) {
    case 'bars':
      return <Bars />
    case 'cats':
      return <Cats />
    case 'avatars':
      return <Avatars />
    case 'progress':
      return <ProgressViz />
    case 'spark':
      return <Spark />
  }
}

// ---- corner chip that cross-fades through a card's options -----------------

function CornerChip({ labels, offset, reduced }: { labels: string[]; offset: number; reduced: boolean }) {
  const [i, setI] = useState(offset % labels.length)
  useEffect(() => {
    if (reduced) return
    const id = setInterval(() => setI((p) => (p + 1) % labels.length), 2200)
    return () => clearInterval(id)
  }, [labels.length, reduced])

  return (
    <span className="relative inline-flex h-6 min-w-[64px] items-center justify-center">
      <AnimatePresence mode="wait">
        <motion.span
          key={labels[i]}
          initial={reduced ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"
          style={{ background: 'var(--color-warm-tint)', color: 'var(--color-warm-ink)' }}
        >
          {labels[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

// ---- the staircase deck ----------------------------------------------------

const N = CARDS.length
const STEP_Y = 60 // tight vertical reveal — a shuffled-deck staircase
const STEP_X = 16 // horizontal climb per step
const BODY_H = 92 // expanded dashboard body height (active card only)

export function HeroBusinessCards({ className }: { className?: string }) {
  const reduced = useMinglaReducedMotion()
  // Spotlight travels through the deck → the card it lands on opens its full
  // dashboard while the rest stay stacked as headers. This is the "shuffle".
  const [active, setActive] = useState(N - 1)
  useEffect(() => {
    if (reduced) return
    const id = setInterval(() => setActive((p) => (p + 1) % N), 2800)
    return () => clearInterval(id)
  }, [reduced])

  return (
    <div
      className={cn('relative w-full max-w-[380px]', className)}
      style={{ height: `${(N - 1) * STEP_Y + 64 + BODY_H + 28}px` }}
      aria-label="Mingla Business dashboard preview"
    >
      {CARDS.map((card, i) => {
        const Icon = card.icon
        const isActive = i === active
        const depth = N - 1 - i // 0 = front/bottom
        return (
          <motion.article
            key={card.id}
            initial={reduced ? false : { opacity: 0, y: 18 }}
            animate={
              reduced ? { opacity: 1 } : { opacity: 1, y: [0, depth % 2 === 0 ? -4 : -6, 0] }
            }
            transition={
              reduced
                ? undefined
                : {
                    opacity: { duration: 0.5, delay: 0.3 + i * 0.09, ease: EASE },
                    y: {
                      duration: 5 + depth * 0.6,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: i * 0.4,
                    },
                  }
            }
            style={{
              position: 'absolute',
              top: i * STEP_Y,
              left: i * STEP_X,
              right: 0,
              zIndex: isActive ? 50 : i,
              boxShadow: isActive ? 'var(--elev-3)' : 'var(--elev-1)',
              transform: `scale(${isActive ? 1.03 : 1})`,
              transformOrigin: 'left top',
              transition: 'box-shadow 0.45s ease, transform 0.45s ease, outline-color 0.45s ease',
              outline: '1.5px solid',
              outlineColor: isActive
                ? 'color-mix(in srgb, var(--color-warm) 55%, transparent)'
                : 'rgba(14,14,16,0.05)',
            }}
            className="overflow-hidden rounded-2xl bg-white p-4"
          >
            {/* header row — always visible */}
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'var(--color-warm-tint)' }}
              >
                <Icon className="h-[18px] w-[18px]" style={{ color: 'var(--color-warm-ink)' }} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-display text-[15px] leading-tight text-text-primary">
                  {card.title}
                </span>
                <span className="truncate text-[11px] text-text-muted">{card.sub}</span>
              </span>
              <span className="ml-auto shrink-0">
                <CornerChip labels={card.chips} offset={i} reduced={reduced} />
              </span>
            </div>

            {/* body — opens only for the spotlighted card */}
            <motion.div
              initial={false}
              animate={{ height: isActive ? BODY_H : 0, opacity: isActive ? 1 : 0 }}
              transition={{ duration: 0.45, ease: EASE }}
              className="overflow-hidden"
            >
              <div className="flex items-end justify-between gap-3 pt-3">
                <div className="flex flex-col">
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-display text-3xl leading-none tracking-[-0.01em] text-text-primary tabular-nums">
                      {card.metric}
                    </span>
                    {card.metricSuffix ? (
                      <span className="text-xs text-text-muted">{card.metricSuffix}</span>
                    ) : null}
                  </span>
                  {card.badge ? (
                    <span
                      className="mt-2 w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{ background: 'rgba(63,139,92,0.12)', color: 'var(--color-success)' }}
                    >
                      {card.badge}
                    </span>
                  ) : null}
                </div>
                <div className="w-[46%] shrink-0 pb-1">
                  <Viz kind={card.viz} />
                </div>
              </div>
            </motion.div>
          </motion.article>
        )
      })}
    </div>
  )
}
