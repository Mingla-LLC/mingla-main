'use client'
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { Card3D, Layer } from '@/components/ui/3d-card'
import { CutoutTile } from './primitives'
import type { HostTool } from '@/lib/design-preview/host-tools'

// #2902 — the tool grid, and the three-step switcher above it.
//
// Design rule from Seth: intentional, not decorative. So every element here is
// load-bearing — a tile that says which tool, a title that is the promise, one
// sentence that says what it does. No evidence paths, no provenance chips, no
// second graphic competing with the first. The card's own moulding is the
// visual interest.

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * The tool card, on the 3D tilt shell.
 *
 * The card follows the cursor with a small rotation, and the tile, title and
 * body sit at different depths so they part slightly as it turns — the
 * layered-depth idea from the supplied 3D card, applied to Mingla's moulded
 * surface rather than to a photograph. Tilt is capped at 6 degrees: the demo's
 * 10.5 reads well on one large card and like a wobble across a grid of ten.
 * `prefers-reduced-motion` renders it flat and still.
 */
export function ToolCard({ tool, icon }: { tool: HostTool; icon: React.ReactNode }) {
  return (
    <Card3D intensity={6}>
      <div className="cut-card cut-card-interactive h-full p-6 sm:p-8">
        <Layer z={40}>
          <CutoutTile>{icon}</CutoutTile>
        </Layer>
        <Layer z={26}>
          <h3 className="mt-4 font-display text-[1.125rem] leading-tight tracking-[-0.02em] text-[var(--cut-ink)]">
            {tool.title}
          </h3>
        </Layer>
        <Layer z={14}>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">{tool.body}</p>
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
  charts,
  label,
}: {
  steps: readonly Step[]
  icons: Record<string, React.ReactNode>
  /** One illustrative chart per step — every section carries a visual. */
  charts?: Record<string, React.ReactNode>
  label: string
}) {
  const reduced = useMinglaReducedMotion()
  const [active, setActive] = useState(0)
  const step = steps[active]

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="mx-auto flex w-fit max-w-full gap-1.5 overflow-x-auto rounded-full p-1.5"
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
                'min-h-11 shrink-0 rounded-full px-6 font-display text-[0.9375rem] transition-all duration-300 focus-ring',
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
          <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-8">
            <div className={cn('grid gap-5', step.tools.length >= 4 ? 'sm:grid-cols-2' : 'sm:grid-cols-3 lg:grid-cols-1')}>
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
            {charts?.[step.id] ? (
              <motion.div
                initial={reduced ? false : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduced ? 0 : 0.55, delay: reduced ? 0 : 0.18, ease: EASE }}
                className="lg:sticky lg:top-28 lg:self-start"
              >
                {charts[step.id]}
              </motion.div>
            ) : null}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
