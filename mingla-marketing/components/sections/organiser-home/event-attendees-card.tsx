'use client'
import { Ticket, Users, Sparkles, Send, type LucideIcon } from 'lucide-react'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — Events tab chart. A live "your event, filling up" card: venue
// capacity bar, headline KPIs (tickets sold / reach / fans acquired by Ari), a
// scroll-up feed of people who just bought a ticket, and a blast/communication
// footer. Sized to match the Venues feed height. Illustrative figures.

interface Buyer {
  initial: string
  name: string
  tier: string
  viaAri?: boolean
}

const BUYERS: Buyer[] = [
  { initial: 'M', name: 'Maya R.', tier: 'GA', viaAri: true },
  { initial: 'D', name: 'Deji O.', tier: 'VIP' },
  { initial: 'S', name: 'Sara K.', tier: 'GA' },
  { initial: 'N', name: 'Noah W.', tier: 'Table', viaAri: true },
  { initial: 'L', name: 'Liv R.', tier: 'GA' },
  { initial: 'F', name: 'Femi A.', tier: 'VIP', viaAri: true },
  { initial: 'A', name: 'Ada N.', tier: 'GA' },
  { initial: 'K', name: 'Kai T.', tier: 'Table' },
]

function Stat({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" style={{ color: 'var(--color-warm-ink)' }} aria-hidden="true" />
        <span className="text-lg font-bold leading-none text-text-primary tabular-nums">{value}</span>
      </span>
      <span className="text-[11px] leading-tight text-text-muted">{label}</span>
    </div>
  )
}

function BuyerRow({ b }: { b: Buyer }) {
  return (
    <div className="flex items-center gap-3.5 border-t border-black/[0.06] px-6 py-3">
      <span className="relative shrink-0">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
          style={{ background: 'var(--color-warm-tint)', color: 'var(--color-warm-ink)' }}
        >
          {b.initial}
        </span>
        <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white">
          <span className="h-2 w-2 rounded-full" style={{ background: 'var(--color-success)' }} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] leading-tight text-text-secondary">
          <span className="font-semibold text-text-primary">{b.name}</span> just bought a ticket
        </p>
        <p className="mt-0.5 text-xs text-text-muted">just now</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {b.viaAri ? (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: 'rgba(63,139,92,0.12)', color: 'var(--color-success)' }}
          >
            <Sparkles className="h-2.5 w-2.5" aria-hidden="true" /> Ari
          </span>
        ) : null}
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: 'var(--color-warm-tint)', color: 'var(--color-warm-ink)' }}
        >
          {b.tier}
        </span>
      </div>
    </div>
  )
}

export function EventAttendeesCard() {
  const reduced = useMinglaReducedMotion()
  const loop = [...BUYERS, ...BUYERS]

  return (
    <div
      data-theme="light"
      className="font-dashboard w-full overflow-hidden rounded-2xl bg-white ring-1 ring-[rgba(14,14,16,0.05)]"
      style={{ boxShadow: 'var(--elev-3)' }}
    >
      {/* Header */}
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
        <span className="text-base font-bold text-text-primary">Your event, filling up</span>
      </div>

      {/* Venue capacity + KPIs */}
      <div className="px-6 pb-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Venue capacity</span>
          <span className="font-semibold text-text-primary tabular-nums">86% full</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-black/[0.06]">
          <div className="h-full rounded-full" style={{ width: '86%', background: 'var(--color-warm)' }} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat icon={Ticket} value="248" label="tickets sold" />
          <Stat icon={Users} value="12.4k" label="reach" />
          <Stat icon={Sparkles} value="64" label="fans via Ari" />
        </div>
      </div>

      {/* Recent ticket buyers — scroll up */}
      <div className="relative h-[300px] overflow-hidden border-t border-black/[0.06] [mask-image:linear-gradient(to_bottom,transparent,#000_10%,#000_90%,transparent)]">
        <div
          className="flex flex-col"
          style={{ animation: reduced ? undefined : 'mingla-marquee-y 22s linear infinite', willChange: 'transform' }}
        >
          {loop.map((b, i) => (
            <BuyerRow key={`${b.name}-${i}`} b={b} />
          ))}
        </div>
      </div>

      {/* Blast / communication footer */}
      <div className="flex items-center gap-3 border-t border-black/[0.06] px-6 py-3.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'var(--color-warm-tint)' }}
        >
          <Send className="h-[16px] w-[16px]" style={{ color: 'var(--color-warm-ink)' }} aria-hidden="true" />
        </span>
        <p className="text-[13px] leading-snug text-text-secondary">
          <span className="font-semibold text-text-primary">Blast sent</span> — 3,200 reached · 31% opened
        </p>
      </div>
    </div>
  )
}
