'use client'
import { Zap, Ticket, Users, Sparkles, type LucideIcon } from 'lucide-react'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — Pop-ups tab chart. Sells the pop-up story: spin up fast, scarcity,
// fast sell-out. A "Selling fast" drop with an almost-full spots bar, speed/
// scarcity/reach KPIs, a scroll-up feed of people claiming the last spots, and an
// "idea to live in minutes with Ari" footer. Reuses the existing chart patterns.
// White card on the dark band, corporate dashboard font. Illustrative figures.

interface Claim {
  initial: string
  name: string
  note: string
  viaAri?: boolean
}

const CLAIMS: Claim[] = [
  { initial: 'M', name: 'Maya R.', note: 'claimed a spot', viaAri: true },
  { initial: 'D', name: 'Deji O.', note: 'claimed a spot' },
  { initial: 'S', name: 'Sara K.', note: 'grabbed one of the last 4' },
  { initial: 'N', name: 'Noah W.', note: 'claimed 2 spots', viaAri: true },
  { initial: 'L', name: 'Liv R.', note: 'claimed a spot' },
  { initial: 'F', name: 'Femi A.', note: 'joined the waitlist' },
  { initial: 'A', name: 'Ada N.', note: 'claimed a spot', viaAri: true },
  { initial: 'K', name: 'Kai T.', note: 'claimed a spot' },
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

function ClaimRow({ c }: { c: Claim }) {
  return (
    <div className="flex items-center gap-3.5 border-t border-black/[0.06] px-6 py-3">
      <span className="relative shrink-0">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
          style={{ background: 'var(--color-warm-tint)', color: 'var(--color-warm-ink)' }}
        >
          {c.initial}
        </span>
        <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white">
          <span className="h-2 w-2 rounded-full" style={{ background: 'var(--color-success)' }} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] leading-tight text-text-secondary">
          <span className="font-semibold text-text-primary">{c.name}</span> {c.note}
        </p>
        <p className="mt-0.5 text-xs text-text-muted">just now</p>
      </div>
      {c.viaAri ? (
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: 'rgba(63,139,92,0.12)', color: 'var(--color-success)' }}
        >
          <Sparkles className="h-2.5 w-2.5" aria-hidden="true" /> Ari
        </span>
      ) : null}
    </div>
  )
}

export function PopupCard() {
  const reduced = useMinglaReducedMotion()
  const loop = [...CLAIMS, ...CLAIMS]

  return (
    <div
      data-theme="light"
      className="font-dashboard w-full overflow-hidden rounded-2xl bg-white text-left ring-1 ring-[rgba(14,14,16,0.05)]"
      style={{ boxShadow: 'var(--elev-3)' }}
    >
      {/* Header — the drop */}
      <div className="px-6 pb-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold tracking-[-0.01em] text-text-primary">Midnight Ramen</h3>
            <p className="mt-1 text-xs text-text-muted">by Chef Tomi · one night only</p>
          </div>
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: 'var(--color-warm-tint)', color: 'var(--color-warm-ink)' }}
          >
            <span className="relative inline-flex h-2 w-2">
              {!reduced ? (
                <span
                  className="absolute inset-0 rounded-full"
                  style={{ background: 'var(--color-warm)', animation: 'mingla-chip-pulse 1.6s ease-in-out infinite' }}
                />
              ) : null}
              <span className="relative h-2 w-2 rounded-full" style={{ background: 'var(--color-warm)' }} />
            </span>
            Selling fast
          </span>
        </div>

        {/* Scarcity bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Spots claimed</span>
            <span className="font-semibold tabular-nums" style={{ color: 'var(--color-warm-ink)' }}>
              46 / 50 · 4 left
            </span>
          </div>
          <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
            <div className="h-full rounded-full" style={{ width: '92%', background: 'var(--color-warm)' }} />
          </div>
        </div>
      </div>

      {/* KPIs — speed / scarcity / reach */}
      <div className="grid grid-cols-3 gap-3 border-t border-black/[0.06] px-6 py-3.5">
        <Stat icon={Zap} value="4 min" label="idea to live" />
        <Stat icon={Ticket} value="2 days" label="to sell out" />
        <Stat icon={Users} value="1.8k" label="reach" />
      </div>

      {/* Claims feed — scroll up */}
      <div className="relative h-[262px] overflow-hidden border-t border-black/[0.06] [mask-image:linear-gradient(to_bottom,transparent,#000_10%,#000_90%,transparent)]">
        <div
          className="flex flex-col"
          style={{ animation: reduced ? undefined : 'mingla-marquee-y 20s linear infinite', willChange: 'transform' }}
        >
          {loop.map((c, i) => (
            <ClaimRow key={`${c.name}-${i}`} c={c} />
          ))}
        </div>
      </div>

      {/* Footer — built with Ari */}
      <div className="flex items-center gap-3 border-t border-black/[0.06] px-6 py-3.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'var(--color-warm-tint)' }}
        >
          <Sparkles className="h-[16px] w-[16px]" style={{ color: 'var(--color-warm-ink)' }} aria-hidden="true" />
        </span>
        <p className="text-[13px] leading-snug text-text-secondary">
          <span className="font-semibold text-text-primary">Built with Ari</span> — idea to live in minutes.
        </p>
      </div>
    </div>
  )
}
