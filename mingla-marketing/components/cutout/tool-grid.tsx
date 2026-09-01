'use client'
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { CutoutCard, CutoutTile } from './primitives'
import type { HostTool } from '@/lib/design-preview/host-tools'

// #2902 — the tool grid, and the three-step switcher above it.
//
// Design rule from Seth: intentional, not decorative. So every element here is
// load-bearing — a tile that says which tool, a title that is the promise, one
// sentence that says what it does. No evidence paths, no provenance chips, no
// second graphic competing with the first. The card's own moulding is the
// visual interest.

const EASE = [0.16, 1, 0.3, 1] as const

export function ToolCard({ tool, icon }: { tool: HostTool; icon: React.ReactNode }) {
  return (
    <CutoutCard pad="md" interactive className="h-full">
      <CutoutTile>{icon}</CutoutTile>
      <h3 className="mt-4 font-display text-[1.125rem] leading-tight tracking-[-0.02em] text-[var(--cut-ink)]">
        {tool.title}
      </h3>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">{tool.body}</p>
    </CutoutCard>
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
          <div
            className={cn(
              'mt-10 grid gap-5',
              step.tools.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3',
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
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
