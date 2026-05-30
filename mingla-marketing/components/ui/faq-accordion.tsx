'use client'
import { useId, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

export interface FAQItem {
  q: string
  a: string
}

interface FAQAccordionProps {
  items: FAQItem[]
  className?: string
}

// ORCH-1010 — first-class focus/keyboard states + warm-ink chevron. Each
// question is a >=44pt button (min-h-14) with aria-expanded + aria-controls;
// the panel is role=region. Expanded rows get a faint warm tint (still 18:1
// ink text over it). Reduced-motion → instant open/close (no height animation).
export function FAQAccordion({ items, className }: FAQAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const reduced = useMinglaReducedMotion()
  const baseId = useId()

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {items.map((item, i) => {
        const isOpen = openIndex === i
        const panelId = `${baseId}-panel-${i}`
        const buttonId = `${baseId}-button-${i}`
        return (
          <div
            key={i}
            className={cn(
              'glass-soft overflow-hidden rounded-md transition-colors duration-200 ease-out-quart',
              isOpen && 'bg-warm/[0.04]',
            )}
            style={{ boxShadow: 'var(--elev-1)' }}
          >
            <button
              type="button"
              id={buttonId}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenIndex(isOpen ? null : i)}
              className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-4 px-6 py-4 text-left transition-colors duration-200 ease-out-quart hover:bg-warm/[0.03] focus-ring"
            >
              <span className="font-display text-lg font-medium text-text-primary md:text-xl">
                {item.q}
              </span>
              <ChevronDown
                className={cn(
                  'h-5 w-5 shrink-0 text-warm-ink transition-transform duration-200 ease-out-quart',
                  isOpen && 'rotate-180',
                )}
                aria-hidden="true"
              />
            </button>
            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  initial={reduced ? false : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <p className="px-6 pb-5 text-base leading-relaxed text-text-secondary">
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
