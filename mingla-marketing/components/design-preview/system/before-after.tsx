'use client'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Reveal } from '@/components/ui/reveal'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// #2902 — the before/after workflow table.
//
// Rendered as a real <table> so it is readable by a screen reader and quotable
// by an answer engine, then visually restyled into paired rows. On mobile it
// collapses to stacked job cards rather than scrolling sideways.

const EASE = [0.16, 1, 0.3, 1] as const

export interface BeforeAfterRow {
  job: string
  before: string
  after: string
}

interface BeforeAfterProps {
  caption: string
  beforeLabel: string
  afterLabel: string
  rows: readonly BeforeAfterRow[]
  polarity: 'light' | 'night'
}

export function BeforeAfter({
  caption,
  beforeLabel,
  afterLabel,
  rows,
  polarity,
}: BeforeAfterProps) {
  const reduced = useMinglaReducedMotion()
  const night = polarity === 'night'

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-0 border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="hidden md:table-header-group">
          <tr>
            <th
              scope="col"
              className={cn(
                'w-[22%] pb-4 text-xs font-semibold uppercase tracking-[0.18em]',
                night ? 'text-white/45' : 'text-text-muted',
              )}
            >
              The job
            </th>
            <th
              scope="col"
              className={cn(
                'w-[39%] pb-4 pl-6 text-xs font-semibold uppercase tracking-[0.18em]',
                night ? 'text-white/45' : 'text-text-muted',
              )}
            >
              {beforeLabel}
            </th>
            <th
              scope="col"
              className="w-[39%] pb-4 pl-6 text-xs font-semibold uppercase tracking-[0.18em] text-warm-ink"
            >
              {afterLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <motion.tr
              key={row.job}
              initial={reduced ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : i * 0.06, ease: EASE }}
              className={cn(
                'block border-t md:table-row',
                night ? 'border-white/10' : 'border-black/[0.08]',
              )}
            >
              <th
                scope="row"
                className={cn(
                  'block pt-6 font-display text-lg leading-tight tracking-[-0.01em] md:table-cell md:w-[22%] md:py-6 md:pr-6 md:align-top md:text-base',
                  night ? 'text-white' : 'text-text-primary',
                )}
              >
                {row.job}
              </th>
              <td
                className={cn(
                  'block pt-3 text-[0.9375rem] leading-relaxed md:table-cell md:w-[39%] md:py-6 md:pl-6 md:align-top',
                  night ? 'text-white/55' : 'text-text-muted',
                )}
              >
                <span
                  className={cn(
                    'mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] md:hidden',
                    night ? 'text-white/40' : 'text-text-muted',
                  )}
                >
                  {beforeLabel}
                </span>
                {row.before}
              </td>
              <td
                className={cn(
                  'block pb-6 pt-4 text-[0.9375rem] font-medium leading-relaxed md:table-cell md:w-[39%] md:py-6 md:pl-6 md:align-top',
                  night ? 'text-white/88' : 'text-text-primary',
                )}
              >
                <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-warm-ink md:hidden">
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  {afterLabel}
                </span>
                {row.after}
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface EducationItem {
  title: string
  body: string
}

interface EducationBlockProps {
  eyebrow: string
  heading: string
  lede: string
  items: readonly EducationItem[]
  polarity: 'light' | 'night'
}

/**
 * The educational band — the part of the page that is useful even to someone
 * who never signs up. Numbered because these are steps, not features.
 */
export function EducationBlock({
  eyebrow,
  heading,
  lede,
  items,
  polarity,
}: EducationBlockProps) {
  const night = polarity === 'night'
  return (
    <div>
      <div className="max-w-2xl">
        <Reveal
          as="span"
          className={cn(
            'block text-xs font-semibold uppercase tracking-[0.2em]',
            night ? 'text-warm' : 'text-warm-ink',
          )}
        >
          {eyebrow}
        </Reveal>
        <Reveal>
          <h2
            className={cn(
              'mt-4 font-display text-3xl leading-[1.08] tracking-[-0.02em] md:text-[2.5rem]',
              night ? 'text-white' : 'text-text-primary',
            )}
          >
            {heading}
          </h2>
        </Reveal>
        <Reveal delay={0.08}>
          <p
            className={cn(
              'mt-5 text-base leading-relaxed md:text-lg',
              night ? 'text-white/70' : 'text-text-secondary',
            )}
          >
            {lede}
          </p>
        </Reveal>
      </div>

      <ol className="mt-12 grid gap-x-10 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => (
          <Reveal key={item.title} delay={0.06 * i} as="div">
            <li className="list-none">
              <span
                aria-hidden="true"
                className={cn(
                  'font-display text-2xl leading-none tabular-nums',
                  night ? 'text-warm/50' : 'text-warm-ink/45',
                )}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3
                className={cn(
                  'mt-3 font-display text-xl leading-tight tracking-[-0.01em]',
                  night ? 'text-white' : 'text-text-primary',
                )}
              >
                {item.title}
              </h3>
              <p
                className={cn(
                  'mt-2.5 text-[0.9375rem] leading-relaxed',
                  night ? 'text-white/62' : 'text-text-secondary',
                )}
              >
                {item.body}
              </p>
            </li>
          </Reveal>
        ))}
      </ol>
    </div>
  )
}
