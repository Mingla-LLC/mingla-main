'use client'
import { motion } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

const REASONS: readonly string[] = [
  'The food.',
  'The room.',
  'The crowd.',
  'The music.',
  'The story.',
  'The host.',
  'The timing.',
  'The feeling.',
  'The "we should go there" moment.',
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
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.6, delay: reduced ? 0 : delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

export function OrganiserWhatMinglaDoes() {
  const reduced = useMinglaReducedMotion()

  return (
    <section className="border-t border-divider px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-4xl text-center">
        <Reveal>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">
            What Mingla does
          </span>
        </Reveal>

        <Reveal delay={0.1}>
          <h2 className="mt-4 font-display text-3xl leading-[1.1] tracking-[-0.01em] text-text-primary md:text-6xl">
            we sell what makes <br className="hidden md:block" />
            <span className="text-warm">you special.</span>
          </h2>
        </Reveal>

        <Reveal delay={0.2}>
          <p className="mx-auto mt-8 max-w-2xl text-base leading-relaxed text-text-secondary md:text-lg">
            People do not choose a place or event because it exists. They choose it because something about it feels worth showing up for.
          </p>
        </Reveal>

        <div className="mt-16 flex flex-col items-center gap-3">
          {REASONS.map((reason, i) => (
            <motion.span
              key={reason}
              initial={reduced ? false : { opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{
                duration: 0.5,
                delay: reduced ? 0 : i * 0.06,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="font-display text-2xl leading-tight tracking-[-0.005em] text-text-primary md:text-4xl"
            >
              {reason}
            </motion.span>
          ))}
        </div>

        <Reveal delay={0.3}>
          <p className="mx-auto mt-16 max-w-2xl text-base leading-relaxed text-text-secondary md:text-lg">
            Mingla helps you define that reason, package it with AI, and put it in front of people who are most likely to care.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
