import type { Metadata } from 'next'

import { CutoutNav, CutoutShell, CutoutSection, CutReveal } from '@/components/cutout'
import { CHART_BANK } from '@/lib/design-preview/chart-bank'
import { BankedFigure } from '@/components/ui/chart-bank'
import { cn } from '@/lib/cn'

// #2902 — the chart bank, on one page.
//
// Every figure Mingla has, live and new, rendered on the ground it was drawn
// for, with where it lives and what it is for. The point is that the next page
// picks one from here rather than someone drawing a sixteenth.

export const metadata: Metadata = {
  title: 'Chart bank — #2902 Cutout preview',
  robots: { index: false, follow: false },
}

export default function ChartBankPage() {
  const cutout = CHART_BANK.filter((c) => c.origin === 'cutout')
  const live = CHART_BANK.filter((c) => c.origin === 'live')

  return (
    <CutoutShell>
      <CutoutNav surface="host" homeHref="/cutout/host" />

      <CutoutSection aria-label="Chart bank">
        <div className="pt-24">
          <CutReveal>
            <h1 className="cut-display-2 font-display">
              <span className="cut-gradient-text">Chart bank.</span>
            </h1>
            <p className="mt-4 max-w-2xl text-[1.0625rem] leading-relaxed text-[var(--cut-body)]">
              Every figure Mingla has — {CHART_BANK.length} of them — so a page picks one
              instead of a sixteenth being drawn. Each is rendered on the ground it was
              built for.
            </p>
          </CutReveal>
        </div>
      </CutoutSection>

      {[
        { key: 'cutout', label: 'Built in this pass', items: cutout },
        { key: 'live', label: 'Already shipped', items: live },
      ].map((group) => (
        <CutoutSection key={group.key} rhythm="tight" aria-label={group.label}>
          <h2 className="font-display text-[1.375rem] text-[var(--cut-ink)]">{group.label}</h2>
          <p className="mt-1.5 text-[0.9375rem] text-[var(--cut-muted)]">
            {group.key === 'live'
              ? 'Production components, pinned by tests. The bank references them — adapting one means adapting it where it lives.'
              : 'Drawn for the dark bento tiles.'}
          </p>

          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {group.items.map((chart, i) => (
              <CutReveal key={chart.id} delay={i * 0.05}>
                <div className="cut-card h-full overflow-hidden">
                  <div className="p-6 sm:p-7">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3 className="font-display text-[1.0625rem] text-[var(--cut-ink)]">
                        {chart.title}
                      </h3>
                      <code className="text-[0.6875rem] text-[var(--cut-muted)]">{chart.id}</code>
                      {chart.marketAware ? (
                        <span className="rounded-full bg-[var(--cut-accent)]/12 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-[var(--cut-accent-ink)]">
                          market aware
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">
                      {chart.shows}
                    </p>
                    <p className="mt-3 text-[0.75rem] text-[var(--cut-muted)]">
                      <code>{chart.source}</code>
                    </p>
                    {chart.caution ? (
                      <p
                        className="mt-3 rounded-lg px-3 py-2 text-[0.8125rem] leading-relaxed"
                        style={{ background: 'rgba(220,38,38,0.07)', color: '#9a2b12' }}
                      >
                        <strong className="font-semibold">Not reusable as-is — </strong>
                        {chart.caution}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {chart.surfaces.map((s) => (
                        <span
                          key={s}
                          className="rounded-full bg-[var(--cut-ink)]/[0.06] px-2.5 py-1 text-[0.6875rem] font-semibold text-[var(--cut-body)]"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Rendered on the ground it was drawn for. A dark-tile figure
                      on parchment reads as broken, and the reverse too. */}
                  <div
                    className={cn(
                      'border-t p-6',
                      chart.tone === 'dark' ? 'bg-[#14120f]' : 'bg-[var(--cut-shell)]',
                    )}
                    style={{ borderColor: 'var(--cut-hairline)' }}
                  >
                    <div className={cn(chart.tone === 'dark' && 'min-h-[14rem]')}>
                      <BankedFigure id={chart.id} />
                    </div>
                  </div>
                </div>
              </CutReveal>
            ))}
          </div>
        </CutoutSection>
      ))}

      <div aria-hidden="true" className="h-20" />
    </CutoutShell>
  )
}
