'use client'
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { CutoutCard, CutoutTile } from './primitives'
import type { HostCapability } from '@/lib/design-preview/host-truth'

// #2902 — AIgocy's `section-services` pattern: an accordion on the left whose
// selection swaps the panel on the right.
//
// It is MANUAL. AIgocy auto-cycles it and so does the shipped /host stepper;
// both move content out from under a reader mid-sentence. Selection here only
// changes on click or arrow key.

const EASE = [0.16, 1, 0.3, 1] as const

export interface AccordionStep {
  id: string
  label: string
  caption: string
  items: readonly HostCapability[]
  panel: React.ReactNode
}

export function CutoutAccordionSwap({
  steps,
  label,
}: {
  steps: readonly AccordionStep[]
  label: string
}) {
  const reduced = useMinglaReducedMotion()
  const [active, setActive] = useState(0)
  const step = steps[active]

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
      <div role="tablist" aria-label={label} aria-orientation="vertical" className="flex flex-col gap-3">
        {steps.map((s, i) => {
          const isActive = i === active
          return (
            <div key={s.id} className={cn('cut-card overflow-hidden', isActive && 'shadow-[var(--cut-shadow-card-hover)]')}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`swap-panel-${s.id}`}
                onClick={() => setActive(i)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                    e.preventDefault()
                    setActive((i + 1) % steps.length)
                  }
                  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                    e.preventDefault()
                    setActive((i - 1 + steps.length) % steps.length)
                  }
                }}
                className="flex min-h-16 w-full items-center gap-4 px-5 py-5 text-left focus-ring sm:px-6"
              >
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-sm tabular-nums transition-colors duration-300"
                  style={{
                    background: isActive ? 'var(--cut-accent)' : 'var(--cut-card-sunken)',
                    color: isActive ? '#fff' : 'var(--cut-body)',
                  }}
                >
                  {i + 1}
                </span>
                <span className="font-display text-[1.0625rem] leading-tight tracking-[-0.015em] text-[var(--cut-ink)] sm:text-xl">
                  {s.label}
                </span>
              </button>

              <AnimatePresence initial={false}>
                {isActive ? (
                  <motion.div
                    id={`swap-panel-${s.id}`}
                    role="tabpanel"
                    initial={reduced ? false : { height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                    transition={{ duration: reduced ? 0 : 0.3, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-6 sm:px-6">
                      <p className="text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">
                        {s.caption}
                      </p>
                      <ul className="mt-5 space-y-4">
                        {s.items.map((cap) => (
                          <li key={cap.id}>
                            <p className="font-display text-[0.9375rem] leading-tight text-[var(--cut-ink)]">
                              {cap.title}
                            </p>
                            <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[var(--cut-body)]">
                              {cap.body}
                            </p>
                            {/* The receipt. Unusual on a marketing page, and the
                                reason an operator believes the claim above it. */}
                            <p
                              className="mt-1.5 truncate font-dashboard text-[0.6875rem] text-[var(--cut-muted)]"
                              title={cap.evidence}
                            >
                              {cap.evidence}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          )
        })}
      </div>

      <div className="lg:sticky lg:top-28 lg:self-start">
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={reduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -10 }}
            transition={{ duration: reduced ? 0 : 0.34, ease: EASE }}
          >
            {step.panel}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

/**
 * AIgocy's "All Features in One" — cards either side of a glowing centre node,
 * linked by thin connector rails. Its single most recognisable layout.
 */
export function CutoutFeatureHub({
  centreLabel,
  features,
}: {
  centreLabel: string
  features: readonly { title: string; body: string; icon: React.ReactNode }[]
}) {
  const left = features.slice(0, Math.ceil(features.length / 2))
  const right = features.slice(Math.ceil(features.length / 2))

  const Column = ({ items }: { items: typeof features }) => (
    <div className="flex flex-col gap-6">
      {items.map((f) => (
        <CutoutCard key={f.title} pad="md" interactive className="relative">
          <CutoutTile>{f.icon}</CutoutTile>
          <h3 className="mt-3 font-display text-[1.0625rem] leading-tight tracking-[-0.015em] text-[var(--cut-ink)] sm:text-xl">
            {f.title}
          </h3>
          <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">{f.body}</p>
        </CutoutCard>
      ))}
    </div>
  )

  return (
    <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-10">
      <Column items={left} />

      <div className="relative flex items-center justify-center py-4 lg:py-0">
        <span
          aria-hidden="true"
          className="absolute h-40 w-40 rounded-full blur-3xl"
          style={{ background: 'rgba(235,120,37,0.30)' }}
        />
        <span
          className="relative flex h-28 w-28 items-center justify-center rounded-[28px] px-3 text-center font-display text-sm leading-tight text-white shadow-[var(--cut-shadow-tile)]"
          style={{ background: 'var(--cut-accent)' }}
        >
          {centreLabel}
        </span>
      </div>

      <Column items={right} />
    </div>
  )
}
