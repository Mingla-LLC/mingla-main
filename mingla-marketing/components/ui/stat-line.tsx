import { Pill } from '@/components/ui/pill'
import { cn } from '@/lib/cn'

// ---------------------------------------------------------------
// ORCH-1010 — <StatLine>
//
// A numberless trust strip: a small inline row of glass Pills naming SHIPPED
// capabilities (e.g. "Native all-in checkout · Email your real buyers ·
// Guest list + check-ins"). NOT a fabricated-metric counter — there are no
// numbers, no invented stats (reality-anchor, DESIGN PART 0.6). Reinforces
// "real product" under the hero without claiming a metric Mingla can't back.
// ---------------------------------------------------------------

interface StatLineProps {
  /** Numberless trust labels. Each becomes a glass pill. */
  items: readonly string[]
  className?: string
}

export function StatLine({ items, className }: StatLineProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {items.map((label) => (
        <Pill key={label} variant="glass" dot={null}>
          {label}
        </Pill>
      ))}
    </div>
  )
}
