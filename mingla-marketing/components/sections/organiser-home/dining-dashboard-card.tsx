'use client'
import { CalendarCheck, Users, Sparkles, Footprints, Zap, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

// ORCH-1010 — Dining tab chart. A restaurant dashboard: weekly payout, covers
// (with daypart split), owned diners, and how diners found you (walk-in foot
// traffic vs Mingla + Ari). Corporate dashboard font, left-aligned, premium.
// Illustrative figures. Sized to match the Venues/Events chart height.

const COVER_SPLIT = [
  { label: 'Dinner', pct: 48, color: '#eb7825' },
  { label: 'Lunch', pct: 33, color: '#f4965a' },
  { label: 'Brunch', pct: 19, color: '#f9b98a' },
]

const AVATARS = ['A', 'M', 'J', 'K', 'R']

export function DiningDashboardCard() {
  return (
    <div
      data-theme="light"
      className="font-dashboard w-full overflow-hidden rounded-2xl bg-white p-5 text-left ring-1 ring-[rgba(14,14,16,0.05)] md:p-6"
      style={{ boxShadow: 'var(--elev-3)' }}
    >
      {/* Header — weekly payout */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            Paid out this week
          </p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="text-4xl font-bold leading-none tracking-[-0.02em] text-text-primary tabular-nums">
              $6,240
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
      </div>

      {/* Two mini cards — covers + diners */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        {/* Covers */}
        <div className="rounded-xl border border-black/[0.06] bg-black/[0.015] p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[13px] font-medium text-text-secondary">Covers</p>
            <CalendarCheck className="h-[18px] w-[18px] text-text-muted" />
          </div>
          <div className="mb-3">
            <span className="text-3xl font-bold tracking-[-0.02em] text-text-primary tabular-nums">128</span>
            <span className="ml-1 text-xs text-text-muted">this week</span>
          </div>
          <div className="mb-2 flex h-2 w-full overflow-hidden rounded-full bg-black/5">
            {COVER_SPLIT.map((s) => (
              <span key={s.label} className="h-full" style={{ width: `${s.pct}%`, background: s.color }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {COVER_SPLIT.map((s) => (
              <span key={s.label} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                <span className="text-[10px] text-text-muted">{s.label}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Diners */}
        <div
          className="rounded-xl p-4"
          style={{
            background: 'color-mix(in srgb, var(--color-warm) 8%, white)',
            border: '1px solid color-mix(in srgb, var(--color-warm) 22%, transparent)',
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[13px] font-medium" style={{ color: 'var(--color-warm-ink)' }}>
              Your diners
            </p>
            <Users className="h-[18px] w-[18px]" style={{ color: 'var(--color-warm-ink)' }} />
          </div>
          <div className="mb-3">
            <span className="text-3xl font-bold tracking-[-0.02em] text-text-primary tabular-nums">1,240</span>
            <span className="ml-1 text-xs text-text-muted">owned</span>
          </div>
          <div className="flex items-center">
            {AVATARS.map((a, i) => (
              <span
                key={a}
                className="-ml-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold first:ml-0"
                style={{
                  background: `color-mix(in srgb, var(--color-warm) ${18 + i * 11}%, white)`,
                  color: 'var(--color-warm-ink)',
                }}
              >
                {a}
              </span>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] text-text-muted">Email your regulars in a tap.</p>
        </div>
      </div>

      {/* How diners found you — acquisition split */}
      <div className="mt-3 rounded-xl border border-black/[0.06] bg-black/[0.015] p-4">
        <p className="mb-3 text-[13px] font-medium text-text-secondary">How diners found you</p>
        <div className="mb-3 flex h-2.5 w-full overflow-hidden rounded-full bg-black/5">
          <span className="h-full" style={{ width: '64%', background: 'var(--color-warm)' }} />
          <span className="h-full" style={{ width: '36%', background: 'rgba(14,14,16,0.18)' }} />
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--color-warm-ink)' }} />
            <span className="text-xs text-text-secondary">
              <span className="font-semibold text-text-primary">64%</span> Mingla + Ari
            </span>
          </span>
          <span className="flex items-center gap-2">
            <Footprints className="h-3.5 w-3.5 text-text-muted" />
            <span className="text-xs text-text-secondary">
              <span className="font-semibold text-text-primary">36%</span> walk-ins
            </span>
          </span>
        </div>
      </div>

      {/* Footer CTA */}
      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-black/[0.03] p-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'var(--color-warm-tint)' }}
          >
            <Zap className="h-[18px] w-[18px]" style={{ color: 'var(--color-warm-ink)' }} />
          </span>
          <p className="text-[13px] font-medium leading-snug text-text-secondary">
            Slow lunch? Ari fills your tables.
          </p>
        </div>
        <Button variant="primary-ink" size="sm" className="shrink-0" aria-label="Boost covers with Mingla AI">
          Boost covers
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
