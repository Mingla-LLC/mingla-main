'use client'
import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ---------------------------------------------------------------
// #2902 — illustrative section charts.
//
// Seth: "Each section should have illustrative charts not just bland copy."
//
// These are ILLUSTRATIVE by design — they demonstrate the shape of a thing, not
// a measured result, and each says so in its own footer. They are drawn in
// CSS/SVG so they re-tint with the brand, animate on the compositor only, and
// cost nothing to load.
// ---------------------------------------------------------------

const EASE = [0.16, 1, 0.3, 1] as const

function Frame({
  title,
  caption,
  children,
  className,
}: {
  title: string
  caption: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('cut-card p-6 sm:p-8', className)}>
      <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-[var(--cut-muted)]">
        {title}
      </p>
      <div className="mt-6">{children}</div>
      <p className="mt-6 text-[0.75rem] leading-relaxed text-[var(--cut-muted)]">{caption}</p>
    </div>
  )
}

/** BUILD — how long a presence takes to exist. */
export function TimeToLiveChart() {
  const reduced = useMinglaReducedMotion()
  const rows = [
    { label: 'Agency build', weeks: 100, value: '6–8 weeks' },
    { label: 'DIY builder', weeks: 34, value: 'A weekend' },
    { label: 'Mingla + Ari', weeks: 4, value: 'Seconds' },
  ]
  return (
    <Frame title="Time to live" caption="Illustrative. Shows the gap, not a benchmark.">
      <ul className="space-y-4">
        {rows.map((r, i) => {
          const last = i === rows.length - 1
          return (
            <li key={r.label}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className={cn('text-[0.875rem]', last ? 'font-bold text-[var(--cut-ink)]' : 'text-[var(--cut-body)]')}>
                  {r.label}
                </span>
                <span className={cn('text-[0.875rem] font-semibold tabular-nums', last ? 'text-[var(--cut-accent-ink)]' : 'text-[var(--cut-muted)]')}>
                  {r.value}
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full" style={{ background: 'var(--cut-card-sunken)' }}>
                <motion.span
                  className="block h-full rounded-full"
                  initial={reduced ? false : { width: 0 }}
                  whileInView={{ width: `${r.weeks}%` }}
                  viewport={{ once: true, amount: 0.5 }}
                  transition={{ duration: reduced ? 0 : 0.9, delay: reduced ? 0 : i * 0.12, ease: EASE }}
                  style={{
                    background: last
                      ? 'linear-gradient(90deg, #f0842f, #dd6a16)'
                      : 'color-mix(in srgb, var(--cut-accent) 26%, transparent)',
                  }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </Frame>
  )
}

/** SELL — the shape of a ticketed sale. */
export function SellThroughChart() {
  const reduced = useMinglaReducedMotion()
  const bars = [26, 17, 9, 6, 5, 5, 7, 9, 12, 17, 24, 34, 45, 21]
  const peak = Math.max(...bars)
  return (
    <Frame title="How a sale actually moves" caption="Illustrative. Read the shape, not the totals.">
      <div className="flex h-32 items-end gap-1.5">
        {bars.map((v, i) => (
          <motion.span
            key={i}
            className="flex-1 rounded-t-md"
            initial={reduced ? false : { height: 0 }}
            whileInView={{ height: `${(v / peak) * 100}%` }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: reduced ? 0 : 0.65, delay: reduced ? 0 : i * 0.035, ease: EASE }}
            style={{
              background: i >= 10 || i === 0
                ? 'linear-gradient(180deg, #f0842f, #dd6a16)'
                : 'color-mix(in srgb, var(--cut-accent) 24%, transparent)',
            }}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-between text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--cut-muted)]">
        <span>Announce</span>
        <span>The quiet middle</span>
        <span>Doors</span>
      </div>
    </Frame>
  )
}

/** GROW — where the next booking comes from. */
export function ChannelMixChart() {
  const reduced = useMinglaReducedMotion()
  const segments = [
    { label: 'Email', pct: 38, color: '#eb7825' },
    { label: 'SMS', pct: 24, color: '#f2a05f' },
    { label: 'Paid ads', pct: 22, color: '#f7c398' },
    { label: 'Discovery', pct: 16, color: '#fbe0c8' },
  ]
  return (
    <Frame title="Where the next booking comes from" caption="Illustrative. Your mix depends on your market.">
      <div className="flex h-4 w-full overflow-hidden rounded-full" style={{ background: 'var(--cut-card-sunken)' }}>
        {segments.map((seg, i) => (
          <motion.span
            key={seg.label}
            className="h-full"
            initial={reduced ? false : { width: 0 }}
            whileInView={{ width: `${seg.pct}%` }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: reduced ? 0 : 0.8, delay: reduced ? 0 : i * 0.1, ease: EASE }}
            style={{ background: seg.color }}
          />
        ))}
      </div>
      <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">
        {segments.map((seg) => (
          <li key={seg.label} className="flex items-center gap-2.5">
            <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: seg.color }} />
            <span className="text-[0.8125rem] font-semibold text-[var(--cut-ink)]">{seg.label}</span>
            <span className="ml-auto text-[0.8125rem] tabular-nums text-[var(--cut-muted)]">{seg.pct}%</span>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

export const STEP_CHARTS: Record<string, React.ReactNode> = {
  build: <TimeToLiveChart />,
  sell: <SellThroughChart />,
  grow: <ChannelMixChart />,
}
