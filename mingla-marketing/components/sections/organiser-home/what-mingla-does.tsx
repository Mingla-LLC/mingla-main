'use client'
import { type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Reveal } from '@/components/ui/reveal'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — the page's emotional core: the litany. Centered, generous,
// slow stagger. Subtract chrome, not add it — the whitespace IS the design.

const EASE = [0.16, 1, 0.3, 1] as const

// The litany. The final line gets the warm-ink accent + italic-quote payoff;
// it is rendered separately so the quoted phrase can carry the <em> treatment.
const LITANY: readonly string[] = [
  'The food.',
  'The room.',
  'The crowd.',
  'The music.',
  'The host who remembers your name.',
  'The view from the trail.',
  "The class you can't stop talking about.",
  'The story only you can tell.',
]

function LitanyLine({ children, index }: { children: ReactNode; index: number }) {
  const reduced = useMinglaReducedMotion()
  return (
    <motion.span
      initial={reduced ? false : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ duration: 0.5, delay: reduced ? 0 : index * 0.06, ease: EASE }}
      className="font-display text-3xl leading-[1.1] tracking-[-0.01em] text-text-primary md:text-5xl"
    >
      {children}
    </motion.span>
  )
}

export function OrganiserWhatMinglaDoes() {
  return (
    <section className="seam-top px-6 py-24 md:px-10 md:py-40 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]">
      <div className="mx-auto max-w-4xl text-center">
        <Reveal as="span" className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink">
          What Mingla does
        </Reveal>

        <Reveal>
          <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-[-0.02em] text-text-primary md:text-7xl">
            we sell what makes <br className="hidden md:block" />
            <span className="text-warm-ink">you special.</span>
          </h2>
        </Reveal>

        <Reveal delay={0.2}>
          <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-text-secondary md:text-xl">
            Nobody chooses a place, an event, or an experience because it exists.
            They choose it because something about it feels worth showing up for.
          </p>
        </Reveal>

        <div className="mt-16 flex flex-col items-center gap-3 md:gap-4">
          {LITANY.map((line, i) => (
            <LitanyLine key={line} index={i}>
              {line}
            </LitanyLine>
          ))}
          {/* Payoff line — warm-ink accent + italic on the quoted phrase only. */}
          <LitanyLine index={LITANY.length}>
            <em className="not-italic text-warm-ink">
              The <span className="italic">&ldquo;we should go there&rdquo;</span> moment.
            </em>
          </LitanyLine>
        </div>

        <Reveal delay={0.3}>
          <p className="mx-auto mt-16 max-w-2xl text-lg leading-relaxed text-text-secondary md:text-xl">
            Mingla helps you name that reason, shape it into a page and a plan
            people understand instantly, and put it in front of the people most
            likely to care.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
