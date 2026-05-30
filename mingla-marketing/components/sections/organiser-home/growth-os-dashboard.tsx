'use client'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BarChart3, Send, Mail, Sparkles, TrendingUp, Check, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — "what you get" interactive growth-OS dashboard. Auto-cycles (and is
// clickable) through four capabilities: Analytics & ROI, text Blasts, Email
// nurturing, and Ari automation. White card, corporate dashboard font, premium.
// Illustrative figures.

const EASE = [0.16, 1, 0.3, 1] as const

const VIEWS = [
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'blasts', label: 'Blasts', icon: Send },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'ari', label: 'Ari', icon: Sparkles },
] as const

function Bars() {
  const h = [42, 60, 50, 74, 64, 88, 96]
  return (
    <div className="flex h-20 items-end gap-2">
      {h.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-md"
          style={{
            height: `${v}%`,
            background: i >= 5 ? 'var(--color-warm)' : 'color-mix(in srgb, var(--color-warm) 26%, transparent)',
          }}
        />
      ))}
    </div>
  )
}

function Funnel({ rows }: { rows: { label: string; pct: number; value: string }[] }) {
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-text-secondary">{r.label}</span>
            <span className="font-semibold text-text-primary tabular-nums">{r.value}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
            <div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: 'var(--color-warm)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function AnalyticsView() {
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Revenue this month</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-bold leading-none tracking-[-0.02em] text-text-primary tabular-nums">
              $24,310
            </span>
            <span className="inline-flex items-center gap-0.5 text-sm font-semibold" style={{ color: 'var(--color-success)' }}>
              <TrendingUp className="size-4" strokeWidth={2.4} /> +18%
            </span>
          </p>
        </div>
        <div className="text-right">
          <span className="text-3xl font-bold leading-none tabular-nums" style={{ color: 'var(--color-warm-ink)' }}>
            12×
          </span>
          <p className="mt-1 text-[11px] text-text-muted">ROI on Mingla</p>
        </div>
      </div>
      <div className="mt-6">
        <Bars />
      </div>
    </div>
  )
}

function BlastsView() {
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: 'var(--color-warm-tint)' }}>
          <Send className="h-[16px] w-[16px]" style={{ color: 'var(--color-warm-ink)' }} />
        </span>
        <div>
          <p className="text-[15px] font-semibold text-text-primary">Text blast sent</p>
          <p className="text-xs text-text-muted">“Tonight only — 20% off the patio 🌅”</p>
        </div>
      </div>
      <div className="mt-5">
        <Funnel
          rows={[
            { label: 'Delivered', pct: 100, value: '3,200' },
            { label: 'Opened', pct: 71, value: '2,270' },
            { label: 'Booked', pct: 24, value: '+240' },
          ]}
        />
      </div>
    </div>
  )
}

function EmailView() {
  const steps = [
    { t: 'Welcome', s: 'sent on first booking' },
    { t: 'Reminder', s: '2 days before the night' },
    { t: 'Win-back', s: 'when a regular goes quiet' },
  ]
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: 'var(--color-warm-tint)' }}>
          <Mail className="h-[16px] w-[16px]" style={{ color: 'var(--color-warm-ink)' }} />
        </span>
        <div>
          <p className="text-[15px] font-semibold text-text-primary">Email nurture, automated</p>
          <p className="text-xs text-text-muted">31% open · 9% rebook</p>
        </div>
      </div>
      <div className="mt-5 space-y-2.5">
        {steps.map((st, i) => (
          <div key={st.t} className="flex items-center gap-3 rounded-xl border border-black/[0.06] bg-black/[0.015] px-3.5 py-2.5">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              style={{ background: 'var(--color-warm-tint)', color: 'var(--color-warm-ink)' }}
            >
              {i + 1}
            </span>
            <span className="text-[13px] text-text-primary">
              <span className="font-semibold">{st.t}</span> <span className="text-text-muted">— {st.s}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AriView() {
  const actions = [
    'Built & published your event page',
    'Sent the weekend text blast',
    'Filled 12 slow-night seats',
    'Replied to 38 booking DMs',
  ]
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: 'var(--color-warm-tint)' }}>
            <Sparkles className="h-[16px] w-[16px]" style={{ color: 'var(--color-warm-ink)' }} />
          </span>
          <p className="text-[15px] font-semibold text-text-primary">Ari ran your marketing</p>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: 'rgba(63,139,92,0.12)', color: 'var(--color-success)' }}
        >
          on autopilot
        </span>
      </div>
      <div className="mt-5 space-y-2.5">
        {actions.map((a) => (
          <div key={a} className="flex items-center gap-3">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
              style={{ background: 'rgba(63,139,92,0.14)' }}
            >
              <Check className="h-3 w-3" style={{ color: 'var(--color-success)' }} strokeWidth={3} />
            </span>
            <span className="text-[13px] text-text-primary">{a}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function renderView(id: (typeof VIEWS)[number]['id']) {
  switch (id) {
    case 'analytics':
      return <AnalyticsView />
    case 'blasts':
      return <BlastsView />
    case 'email':
      return <EmailView />
    case 'ari':
      return <AriView />
  }
}

export function GrowthOsDashboard() {
  const reduced = useMinglaReducedMotion()
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (reduced) return
    const id = setInterval(() => setActive((p) => (p + 1) % VIEWS.length), 3400)
    return () => clearInterval(id)
  }, [reduced])

  const view = VIEWS[active]

  return (
    <div
      className="font-dashboard mx-auto w-full max-w-xl overflow-hidden rounded-2xl bg-white p-6 text-left ring-1 ring-[rgba(14,14,16,0.05)] md:p-7"
      style={{ boxShadow: 'var(--elev-3)' }}
    >
      {/* View switcher */}
      <div role="tablist" aria-label="Capability" className="flex flex-nowrap gap-1.5 sm:gap-2">
        {VIEWS.map((v, i) => {
          const Icon = v.icon
          const isActive = i === active
          return (
            <button
              key={v.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(i)}
              className={cn(
                'inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-2 text-[11px] font-semibold transition-colors duration-200 focus-ring sm:text-xs',
                isActive
                  ? 'bg-warm text-white'
                  : 'bg-black/[0.04] text-text-secondary hover:bg-black/[0.07]',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {v.label}
            </button>
          )
        })}
      </div>

      {/* Active view */}
      <div className="mt-6 min-h-[208px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={view.id}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.32, ease: EASE }}
          >
            {renderView(view.id)}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
