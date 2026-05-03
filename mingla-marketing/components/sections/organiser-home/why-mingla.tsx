'use client'
import { motion } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

interface Pair {
  generic: string
  specific: string
}

const PAIRS: Pair[] = [
  {
    generic: 'they don\'t just want "a restaurant."',
    specific: 'they want somewhere cute but not too loud.',
  },
  {
    generic: 'they don\'t just want "an event."',
    specific: 'they want something that feels worth leaving the house for.',
  },
  {
    generic: 'they don\'t just want "a class."',
    specific: 'they want a social plan that feels fun, useful, or different.',
  },
  {
    generic: 'they don\'t just want "a market."',
    specific: 'they want a weekend ritual.',
  },
  {
    generic: 'they don\'t just want "a bar."',
    specific: 'they want the right energy.',
  },
]

function Reveal({
  children,
  delay = 0,
}: {
  children: React.ReactNode
  delay?: number
}) {
  const reduced = useMinglaReducedMotion()
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, delay: reduced ? 0 : delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

export function OrganiserWhyMingla() {
  return (
    <section className="border-t border-divider bg-vellum px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-4xl">
        <Reveal>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">
            Why Mingla
          </span>
        </Reveal>

        <Reveal delay={0.1}>
          <h2 className="mt-4 font-display text-3xl leading-[1.1] tracking-[-0.01em] text-text-primary md:text-6xl">
            because people choose <br className="hidden md:block" />
            <span className="text-warm">feelings before categories.</span>
          </h2>
        </Reveal>

        <div className="mt-16 flex flex-col gap-6 md:gap-8">
          {PAIRS.map((pair, i) => (
            <Reveal key={pair.generic} delay={0.06 * i + 0.2}>
              <div className="grid gap-2 border-t border-divider pt-6 md:grid-cols-2 md:gap-8">
                <p className="text-sm text-text-muted md:text-base">
                  {pair.generic}
                </p>
                <p className="font-display text-lg leading-snug tracking-[-0.005em] text-text-primary md:text-2xl">
                  {pair.specific}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.5}>
          <p className="mt-16 text-center font-display text-xl leading-snug tracking-[-0.005em] text-text-primary md:text-3xl">
            Mingla turns those feelings <span className="text-warm">into discovery.</span>
          </p>
        </Reveal>
      </div>
    </section>
  )
}
