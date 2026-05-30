'use client'
import { ArrowRight, Users, Eye, Wallet, Sparkles, type LucideIcon } from 'lucide-react'

// ORCH-1010 — Experiences tab chart. A packed trip-planner dashboard: route,
// dates, capacity, who's going, live analytics, and a 4-day itinerary — to show
// Mingla is a power tool for trip + experience organizers. Adapted from the
// TripDetailsCard concept into Mingla's warm system (corporate dashboard font,
// white card on the dark band). Illustrative figures. Height-matched.

const ITINERARY = [
  { day: 'Day 1', title: 'Sunset catamaran cruise' },
  { day: 'Day 2', title: 'Winelands tour & tasting' },
  { day: 'Day 3', title: 'Table Mountain hike' },
  { day: 'Day 4', title: 'Boulders Beach + farewell dinner' },
]

const AVATARS = ['A', 'M', 'J', 'K', 'R', 'L']

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

export function TripPlannerCard() {
  return (
    <div
      data-theme="light"
      className="font-dashboard w-full overflow-hidden rounded-2xl bg-white text-left ring-1 ring-[rgba(14,14,16,0.05)]"
      style={{ boxShadow: 'var(--elev-3)' }}
    >
      {/* Header — route + status */}
      <div className="px-6 pb-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-xl font-bold tracking-[-0.01em] text-text-primary">
              Lagos <ArrowRight className="h-4 w-4 text-text-muted" /> Cape Town
            </h3>
            <p className="mt-1 text-xs text-text-muted">by Lola&rsquo;s Escapes · 4 days</p>
          </div>
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: 'rgba(63,139,92,0.12)', color: 'var(--color-success)' }}
          >
            Selling
          </span>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-black/[0.06] pt-3 text-sm">
          <span className="text-text-secondary">Jun 20–24</span>
          <span className="font-semibold text-text-primary">
            $540 <span className="font-normal text-text-muted">/ person</span>
          </span>
        </div>
      </div>

      {/* Capacity */}
      <div className="px-6 pb-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Spots booked</span>
          <span className="font-semibold text-text-primary tabular-nums">18 / 24</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-black/[0.06]">
          <div className="h-full rounded-full" style={{ width: '75%', background: 'var(--color-warm)' }} />
        </div>
      </div>

      {/* Who's going */}
      <div className="flex items-center gap-3 px-6 pb-4">
        <div className="flex">
          {AVATARS.map((a, i) => (
            <span
              key={a}
              className="-ml-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold first:ml-0"
              style={{
                background: `color-mix(in srgb, var(--color-warm) ${16 + i * 9}%, white)`,
                color: 'var(--color-warm-ink)',
              }}
            >
              {a}
            </span>
          ))}
        </div>
        <span className="text-xs text-text-muted">+12 going</span>
      </div>

      {/* Analytics */}
      <div className="grid grid-cols-3 gap-3 border-t border-black/[0.06] px-6 py-3.5">
        <Stat icon={Wallet} value="$9,720" label="booked" />
        <Stat icon={Users} value="6" label="spots left" />
        <Stat icon={Eye} value="2.4k" label="page views" />
      </div>

      {/* Itinerary */}
      <div className="border-t border-black/[0.06] px-6 py-3">
        <p className="mb-3 text-[13px] font-medium text-text-secondary">Itinerary</p>
        <div className="space-y-2.5">
          {ITINERARY.map((it) => (
            <div key={it.day} className="flex items-center gap-3">
              <span className="w-12 shrink-0 text-[11px] font-semibold" style={{ color: 'var(--color-warm-ink)' }}>
                {it.day}
              </span>
              <span className="text-[13px] text-text-primary">{it.title}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer — built by Ari */}
      <div className="flex items-center gap-3 border-t border-black/[0.06] px-6 py-3.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'var(--color-warm-tint)' }}
        >
          <Sparkles className="h-[16px] w-[16px]" style={{ color: 'var(--color-warm-ink)' }} aria-hidden="true" />
        </span>
        <p className="text-[13px] leading-snug text-text-secondary">
          <span className="font-semibold text-text-primary">Page built by Ari</span> — in minutes, not weeks.
        </p>
      </div>
    </div>
  )
}
