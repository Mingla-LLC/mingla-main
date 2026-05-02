'use client'
import { motion } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

interface Step {
  n: string
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    n: '01',
    title: 'tell us what you have',
    body: 'Your place, menu, event, offer, room, activity, show, pop-up, class, market, or concept.',
  },
  {
    n: '02',
    title: 'mingla finds the reason',
    body: 'Our AI labels the vibe, surfaces what makes it desirable, shapes the message, and turns it into something people instantly understand.',
  },
  {
    n: '03',
    title: 'we match it with the right people',
    body: 'Mingla connects your offer to people based on taste, mood, location, timing, budget, social plans, and intent.',
  },
  {
    n: '04',
    title: 'you get action',
    body: 'People discover, save, share, book, buy, attend, review, and come back.',
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

export function OrganiserHowItWorks() {
  return (
    <section className="border-t border-divider bg-vellum px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">
            How it works
          </span>
        </Reveal>

        <Reveal delay={0.1}>
          <h2 className="mt-4 max-w-3xl font-display text-3xl leading-[1.1] tracking-[-0.01em] text-text-primary md:text-6xl">
            from raw offer <br className="hidden md:block" />
            <span className="text-warm">to real demand.</span>
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {STEPS.map((step, i) => (
            <Reveal key={step.n} delay={0.08 * i + 0.2}>
              <div className="flex flex-col gap-4">
                <span className="font-display text-base font-semibold text-warm">
                  {step.n}
                </span>
                <h3 className="font-display text-xl leading-tight tracking-[-0.005em] text-text-primary md:text-2xl">
                  {step.title}
                </h3>
                <p className="text-base leading-relaxed text-text-secondary">
                  {step.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
