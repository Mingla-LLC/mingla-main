'use client'
import * as React from 'react'
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  type Variants,
} from 'framer-motion'
import { CalendarCheck, Users, Zap, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — business hero artifact (v3).
//
// A single live "growth-OS" dashboard card adapted from the marketing-dashboard
// pattern, themed to Mingla's warm system. It count-ups the payout headline,
// animates a segmented bookings bar (every category Mingla sells), stacks the
// owned-customer avatars, and ends on the AI slow-day CTA. All values are
// illustrative product mockups (ORCH-1007 posture) — not live account data.
//
// Reality note for the live site: email blasts ship today; the AI slow-day
// optimiser + full CRM are roadmap — operator owns the framing decision.

const EASE = [0.16, 1, 0.3, 1] as const

// Count-up number with comma grouping; static under reduced motion.
function AnimatedNumber({ value, reduced }: { value: number; reduced: boolean }) {
  const count = useMotionValue(reduced ? value : 0)
  const text = useTransform(count, (latest) => Math.round(latest).toLocaleString('en-US'))
  React.useEffect(() => {
    if (reduced) return
    const controls = animate(count, value, { duration: 1.4, ease: 'easeOut' })
    return controls.stop
  }, [value, count, reduced])
  return <motion.span>{text}</motion.span>
}

// Bookings split across every category Mingla sells (sums to 100).
const BOOKING_SEGMENTS = [
  { label: 'Events', value: 34, color: '#eb7825' },
  { label: 'Tables', value: 28, color: '#f4965a' },
  { label: 'Trips', value: 16, color: '#f9b98a' },
  { label: 'Experiences', value: 22, color: '#fcd9bf' },
] as const

const AVATARS = [
  { id: 'a', initial: 'A' },
  { id: 'm', initial: 'M' },
  { id: 'j', initial: 'J' },
  { id: 'k', initial: 'K' },
  { id: 'r', initial: 'R' },
] as const

export function HeroBusinessCards({ className }: { className?: string }) {
  const reduced = useMinglaReducedMotion()

  const container: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { staggerChildren: reduced ? 0 : 0.1, delayChildren: reduced ? 0 : 0.15 },
    },
  }
  const item: Variants = {
    hidden: reduced ? { opacity: 1 } : { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
  }
  const hover = reduced ? undefined : { scale: 1.02, y: -4 }
  const hoverSpring = { type: 'spring' as const, stiffness: 300, damping: 16 }

  return (
    <motion.div
      className={cn(
        'font-dashboard w-full max-w-[440px] rounded-2xl bg-white p-5 md:p-6',
        className,
      )}
      style={{ boxShadow: 'var(--elev-3)', outline: '1px solid rgba(14,14,16,0.05)' }}
      variants={container}
      initial="hidden"
      animate="visible"
      aria-label="Mingla Business dashboard preview"
    >
      {/* Header — payouts headline */}
      <motion.div variants={item} className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            Paid out this week
          </p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="text-4xl font-bold leading-none tracking-[-0.02em] text-text-primary tabular-nums">
              $<AnimatedNumber value={4820} reduced={reduced} />
            </span>
            <span className="text-sm text-text-muted">straight to you</span>
          </p>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: 'rgba(63,139,92,0.12)', color: 'var(--color-success)' }}
        >
          99% kept
        </span>
      </motion.div>

      {/* Stat grid — bookings + customers */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Bookings */}
        <motion.div variants={item} whileHover={hover} transition={hoverSpring}>
          <div className="h-full rounded-xl border border-black/[0.06] bg-black/[0.015] p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[13px] font-medium text-text-secondary">Bookings</p>
              <CalendarCheck className="h-[18px] w-[18px] text-text-muted" />
            </div>
            <div className="mb-3">
              <span className="text-3xl font-bold tracking-[-0.02em] text-text-primary tabular-nums">
                <AnimatedNumber value={128} reduced={reduced} />
              </span>
              <span className="ml-1 text-xs text-text-muted">this week</span>
            </div>
            {/* segmented bar */}
            <div className="mb-2 flex h-2 w-full overflow-hidden rounded-full bg-black/5">
              {BOOKING_SEGMENTS.map((s, i) => (
                <motion.span
                  key={s.label}
                  className="h-full"
                  style={{ background: s.color }}
                  initial={reduced ? false : { width: 0 }}
                  animate={{ width: `${s.value}%` }}
                  transition={{ duration: 0.9, delay: reduced ? 0 : 0.6 + i * 0.12, ease: EASE }}
                />
              ))}
            </div>
            {/* legend */}
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {BOOKING_SEGMENTS.map((s) => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  <span className="text-[10px] text-text-muted">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Customers (CRM) — warm-tinted accent card */}
        <motion.div variants={item} whileHover={hover} transition={hoverSpring}>
          <div
            className="h-full rounded-xl p-4"
            style={{
              background: 'color-mix(in srgb, var(--color-warm) 8%, white)',
              border: '1px solid color-mix(in srgb, var(--color-warm) 22%, transparent)',
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[13px] font-medium" style={{ color: 'var(--color-warm-ink)' }}>
                Your customers
              </p>
              <Users className="h-[18px] w-[18px]" style={{ color: 'var(--color-warm-ink)' }} />
            </div>
            <div className="mb-3">
              <span className="text-3xl font-bold tracking-[-0.02em] text-text-primary tabular-nums">
                <AnimatedNumber value={1240} reduced={reduced} />
              </span>
              <span className="ml-1 text-xs text-text-muted">owned</span>
            </div>
            <div className="flex items-center">
              {AVATARS.slice(0, 5).map((m, i) => (
                <motion.span
                  key={m.id}
                  initial={reduced ? false : { opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.45, delay: reduced ? 0 : 0.8 + i * 0.08, ease: EASE }}
                  whileHover={reduced ? undefined : { scale: 1.18, y: -2, zIndex: 10 }}
                  className="-ml-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold first:ml-0"
                  style={{
                    background: `color-mix(in srgb, var(--color-warm) ${18 + i * 11}%, white)`,
                    color: 'var(--color-warm-ink)',
                  }}
                >
                  {m.initial}
                </motion.span>
              ))}
            </div>
            <p className="mt-2.5 text-[11px] text-text-muted">Email your real buyers in a tap.</p>
          </div>
        </motion.div>
      </div>

      {/* CTA banner — AI advertising / slow-day foot traffic */}
      <motion.div variants={item} whileHover={reduced ? undefined : { scale: 1.01 }} transition={hoverSpring} className="mt-3">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-black/[0.03] p-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              style={{ background: 'var(--color-warm-tint)' }}
            >
              <Zap className="h-[18px] w-[18px]" style={{ color: 'var(--color-warm-ink)' }} />
            </span>
            <p className="text-[13px] font-medium leading-snug text-text-secondary">
              Slow night ahead? Mingla&apos;s AI fills your empty seats.
            </p>
          </div>
          <Button variant="primary-ink" size="sm" className="shrink-0" aria-label="Boost reach with Mingla AI">
            Boost reach
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
