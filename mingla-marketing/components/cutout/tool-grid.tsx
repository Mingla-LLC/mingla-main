'use client'
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { Card3D, Layer } from '@/components/ui/3d-card'
import { CutoutTile } from './primitives'
import { ToolVisual } from './tool-visuals'
import type { HostTool } from '@/lib/design-preview/host-tools'

// #2902 — the tool card and the Build / Sell / Grow switcher.
//
// Every card now carries ITS OWN illustrative figure rather than the step
// sharing one chart off to the side: a site assembling, a calendar filling,
// sales climbing, a reach ring opening, an email funnel narrowing. Ten cards,
// ten figures, each condensed to ~76px so it sits under the copy instead of
// pushing it out.

const EASE = [0.16, 1, 0.3, 1] as const

export function ToolCard({ tool, icon }: { tool: HostTool; icon: React.ReactNode }) {
  return (
    <Card3D intensity={6}>
      <div className="cut-card cut-card-interactive flex h-full flex-col p-6 sm:p-7">
        <Layer z={40}>
          <CutoutTile>{icon}</CutoutTile>
        </Layer>
        <Layer z={26}>
          <h3 className="mt-4 font-display text-[1.0625rem] leading-tight tracking-[-0.02em] text-[var(--cut-ink)]">
            {tool.title}
          </h3>
        </Layer>
        <Layer z={14}>
          <p className="mt-2 text-[0.875rem] leading-relaxed text-[var(--cut-body)]">{tool.body}</p>
        </Layer>
        <Layer z={20} className="mt-auto">
          <ToolVisual id={tool.id} />
        </Layer>
      </div>
    </Card3D>
  )
}

export interface Step {
  id: string
  label: string
  caption: string
  tools: readonly HostTool[]
}

export function StepSwitcher({
  steps,
  icons,
  label,
}: {
  steps: readonly Step[]
  icons: Record<string, React.ReactNode>
  label: string
}) {
  const reduced = useMinglaReducedMotion()
  const [active, setActive] = useState(0)
  const step = steps[active]

  return (
    <div>
      {/* Three tabs, three equal columns, no horizontal scroll. The strip was
          `overflow-x-auto`, which on a phone meant a tab could sit off-screen
          with nothing to say so. Three short labels fit 390px comfortably. */}
      <div
        role="tablist"
        aria-label={label}
        className="mx-auto grid w-full max-w-md grid-cols-3 gap-1.5 rounded-full p-1.5"
        style={{ background: 'var(--cut-card-sunken)' }}
      >
        {steps.map((s, i) => {
          const isActive = i === active
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`step-${s.id}`}
              onClick={() => setActive(i)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') { e.preventDefault(); setActive((i + 1) % steps.length) }
                if (e.key === 'ArrowLeft') { e.preventDefault(); setActive((i - 1 + steps.length) % steps.length) }
              }}
              className={cn(
                'min-h-11 w-full rounded-full px-3 font-display text-[0.9375rem] transition-all duration-300 focus-ring',
                isActive ? 'cut-btn cut-btn-brand' : 'text-[var(--cut-body)] hover:text-[var(--cut-ink)]',
              )}
            >
              {s.label}
            </button>
          )
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          id={`step-${step.id}`}
          role="tabpanel"
          initial={reduced ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: -12 }}
          transition={{ duration: reduced ? 0 : 0.36, ease: EASE }}
          className="mt-10"
        >
          <p className="mx-auto max-w-xl text-center text-[1.0625rem] leading-relaxed text-[var(--cut-body)]">
            {step.caption}
          </p>

          {/* One column on a phone, so every card is reachable by scrolling
              rather than hidden behind a swipe. Three on desktop. A fourth
              card centres itself instead of sitting orphaned at the left. */}
          <div
            className={cn(
              'mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3',
              step.tools.length === 4 && '[&>*:last-child]:lg:col-start-2',
            )}
          >
            {step.tools.map((tool, i) => (
              <motion.div
                key={tool.id}
                initial={reduced ? false : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : 0.08 + i * 0.07, ease: EASE }}
              >
                <ToolCard tool={tool} icon={icons[tool.id]} />
              </motion.div>
            ))}
          </div>

          <p className="mt-8 text-center text-[0.75rem] text-[var(--cut-muted)]">
            Figures are illustrative — they show the shape of the thing, not a measured result.
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
