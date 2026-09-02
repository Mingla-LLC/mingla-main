'use client'
import { type ReactNode, useId, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// #2902 — the interactive three-step product demonstration, shared by both
// surfaces.
//
// Deliberately MANUAL. The current /host "What is Mingla" stepper auto-advances
// on scroll-into-view, which moves the reader's content out from under them and
// is the exact behaviour the brief rules out. Here the reader drives: click, or
// use the arrow keys, and nothing changes until they do.
//
// Keyboard contract follows the WAI-ARIA tabs pattern: one tab stop for the
// whole rail (roving tabindex), Left/Right and Home/End move selection, and the
// panel is labelled by its tab.

const EASE = [0.16, 1, 0.3, 1] as const

export interface DemoStep {
  id: string
  /** Verb-first label on the control (e.g. "Build it"). */
  label: string
  /** The sentence explaining what the operator does at this step. */
  caption: string
  /** The product surface for this step. */
  panel: ReactNode
}

interface ThreeStepDemoProps {
  steps: readonly DemoStep[]
  polarity: 'light' | 'night'
  /** Accessible name for the tablist. */
  label: string
  className?: string
}

export function ThreeStepDemo({ steps, polarity, label, className }: ThreeStepDemoProps) {
  const reduced = useMinglaReducedMotion()
  const [active, setActive] = useState(0)
  const baseId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const night = polarity === 'night'

  const focusStep = (next: number): void => {
    const i = (next + steps.length) % steps.length
    setActive(i)
    tabRefs.current[i]?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number): void => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        focusStep(i + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        focusStep(i - 1)
        break
      case 'Home':
        e.preventDefault()
        focusStep(0)
        break
      case 'End':
        e.preventDefault()
        focusStep(steps.length - 1)
        break
      default:
        break
    }
  }

  const step = steps[active]

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        className="grid gap-2 sm:grid-cols-3"
      >
        {steps.map((s, i) => {
          const isActive = i === active
          return (
            <button
              key={s.id}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${s.id}`}
              aria-selected={isActive}
              aria-controls={`${baseId}-panel-${s.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'group flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left',
                'transition-colors duration-200 ease-out-quart focus-ring',
                isActive
                  ? 'bg-warm text-white'
                  : night
                    ? 'bg-white/[0.06] text-white/70 ring-1 ring-inset ring-white/10 hover:bg-white/[0.11] hover:text-white'
                    : 'bg-black/[0.035] text-text-secondary ring-1 ring-inset ring-black/[0.06] hover:bg-black/[0.06] hover:text-text-primary',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-sm tabular-nums',
                  isActive
                    ? 'bg-white/20 text-white'
                    : night
                      ? 'bg-white/10 text-white/60'
                      : 'bg-black/[0.06] text-text-muted',
                )}
              >
                {i + 1}
              </span>
              <span className="font-display text-base leading-tight tracking-[-0.01em]">
                {s.label}
              </span>
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-${step.id}`}
        aria-labelledby={`${baseId}-tab-${step.id}`}
        tabIndex={0}
        className="mt-8 rounded-2xl focus-ring"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: reduced ? 0 : 0.32, ease: EASE }}
          >
            <p
              className={cn(
                'mb-6 max-w-2xl text-base leading-relaxed md:text-lg',
                night ? 'text-white/70' : 'text-text-secondary',
              )}
            >
              {step.caption}
            </p>
            {step.panel}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
