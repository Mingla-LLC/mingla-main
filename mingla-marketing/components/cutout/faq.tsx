'use client'
import { useId, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import type { FaqEntry } from './schema'

// #2902 — Cutout FAQ.
//
// IMPORTANT for the answer-engine half: the answer text is in the DOM at first
// paint whether or not the row is open. Collapsing is done with height and
// opacity, never by unmounting, so a crawler that does not click still reads
// every answer. That is also why the same array feeds <FaqSchema>.

export function CutoutFaq({ items }: { items: readonly FaqEntry[] }) {
  const [open, setOpen] = useState<number | null>(0)
  const reduced = useMinglaReducedMotion()
  const baseId = useId()

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => {
        const isOpen = open === i
        const panelId = `${baseId}-panel-${i}`
        const buttonId = `${baseId}-button-${i}`
        return (
          <div
            key={item.q}
            className={cn('cut-card overflow-hidden', isOpen && 'shadow-[var(--cut-shadow-card-hover)]')}
          >
            <h3>
              <button
                type="button"
                id={buttonId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex min-h-16 w-full cursor-pointer items-center justify-between gap-5 px-6 py-5 text-left focus-ring sm:px-7"
              >
                <span className="font-display text-[1.0625rem] leading-snug text-[var(--cut-ink)] sm:text-xl">
                  {item.q}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform duration-300 ease-out-quart',
                    isOpen ? 'rotate-45' : 'rotate-0',
                  )}
                  style={{
                    background: isOpen ? 'var(--cut-accent)' : 'var(--cut-card-sunken)',
                    color: isOpen ? '#fff' : 'var(--cut-ink)',
                  }}
                >
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                </span>
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  initial={reduced ? false : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <p className="px-6 pb-6 text-base leading-relaxed text-[var(--cut-body)] sm:px-7">
                    {item.a}
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}
