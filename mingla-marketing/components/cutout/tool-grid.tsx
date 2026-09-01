'use client'
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { Card3D, Layer } from '@/components/ui/3d-card'
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
 * The tool card, on the supplied 3D travel-card design.
 *
 * Same anatomy as the reference: a photograph filling the card, the title and
 * a subtitle over it, a circular control in the top-right, and a full-width
 * glass panel at the foot. Two deliberate differences:
 *
 *   - The top-right circle carries THE TOOL'S OWN ICON instead of an arrow.
 *     The reference's arrow means "go somewhere"; these cards do not navigate,
 *     and an arrow that leads nowhere is a dead affordance. The icon is what
 *     tells you which tool this is, so that is what goes in the slot.
 *   - The foot is a glass PANEL, not a button, for the same reason — it holds
 *     the tool's sentence. A button-shaped thing that cannot be pressed is the
 *     dead-tap this codebase forbids.
 *
 * Photography is Mingla's own Lagos place-pool imagery, used illustratively:
 * real, owned, and specific rather than stock.
 */
export function ToolCard({
  tool,
  icon,
  imageUrl,
}: {
  tool: HostTool
  icon: React.ReactNode
  imageUrl: string
}) {
  return (
    <Card3D intensity={7}>
      <div
        className="relative h-full overflow-hidden rounded-[var(--cut-r-card)]"
        style={{ boxShadow: 'var(--cut-mould)' }}
      >
        <img
          src={imageUrl}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Contrast floor. The photograph is texture; it never carries the copy. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(10,9,8,0.58) 0%, rgba(10,9,8,0.30) 34%, rgba(10,9,8,0.72) 72%, rgba(10,9,8,0.92) 100%)',
          }}
        />

        <div className="relative flex h-full flex-col justify-between p-4 text-white sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <Layer z={45}>
              <h3 className="font-display text-[1.0625rem] leading-tight tracking-[-0.02em] text-white">
                {tool.title}
              </h3>
              <p className="mt-1 text-[0.75rem] font-medium text-white/70">{tool.group}</p>
            </Layer>
            <Layer z={60}>
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/18 text-white ring-1 ring-inset ring-white/30 backdrop-blur-md"
              >
                <span className="h-[18px] w-[18px]">{icon}</span>
              </span>
            </Layer>
          </div>

          <Layer z={30}>
            <p className="rounded-2xl bg-white/12 px-3.5 py-3 text-[0.8125rem] leading-snug text-white ring-1 ring-inset ring-white/20 backdrop-blur-md">
              {tool.body}
            </p>
          </Layer>
        </div>
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
  images,
  charts,
  label,
}: {
  steps: readonly Step[]
  icons: Record<string, React.ReactNode>
  images: Record<string, string>
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
          <div
            className={cn(
              'mt-10 grid gap-5 sm:grid-cols-2',
              step.tools.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
            )}
          >
            {step.tools.map((tool, i) => (
              <motion.div
                key={tool.id}
                className="h-[19rem]"
                initial={reduced ? false : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : 0.08 + i * 0.07, ease: EASE }}
              >
                <ToolCard tool={tool} icon={icons[tool.id]} imageUrl={images[tool.id]} />
              </motion.div>
            ))}
          </div>

          {charts?.[step.id] ? (
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0 : 0.55, delay: reduced ? 0 : 0.2, ease: EASE }}
              className="mx-auto mt-6 w-full max-w-2xl"
            >
              {charts[step.id]}
            </motion.div>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
