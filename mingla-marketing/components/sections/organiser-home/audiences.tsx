'use client'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

interface Audience {
  eyebrow: string
  title: string
  body: string
  cta: string
}

const AUDIENCES: Audience[] = [
  {
    eyebrow: 'Restaurants',
    title: 'turn your menu into a craving.',
    body: 'Your handmade pasta. Your patio. Your lighting. Your cocktail list. The chef\'s special. Mingla packages your menu, ambience, and occasions into reasons people want to book, visit, and return.',
    cta: 'Bring people to your table',
  },
  {
    eyebrow: 'Bars, clubs, nightlife',
    title: 'turn your energy into a crowd.',
    body: 'The DJ. The sound. The drinks. The room. The dress code. The thing everyone wants to be part of. Mingla packages your vibe, lineup, and atmosphere into reasons people show up.',
    cta: 'Build your next crowd',
  },
  {
    eyebrow: 'Venues, activity spaces',
    title: 'turn your space into the plan.',
    body: 'Your venue is a date, a birthday, a group hang, a team outing, a weekend ritual. Mingla shapes your space, packages, and ambience into plans people want to choose.',
    cta: 'Sell more group plans',
  },
  {
    eyebrow: 'Events, promoters',
    title: 'turn your event into something people don\'t want to miss.',
    body: 'A flyer says what\'s happening. Mingla explains why it matters. The lineup, the crowd, the culture, the timing — packaged into a clear, desirable reason to attend.',
    cta: 'Sell your next event',
  },
  {
    eyebrow: 'Pop-ups, independent creators',
    title: 'turn your concept into a must-show-up moment.',
    body: 'A pop-up has to land fast. Mingla helps chefs, artists, makers, instructors, and curators turn their concept, scarcity, and offer into something people feel they cannot miss.',
    cta: 'Launch your pop-up',
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

export function OrganiserAudiences() {
  return (
    <section className="border-t border-divider px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">
            Built for
          </span>
        </Reveal>

        <Reveal delay={0.1}>
          <h2 className="mt-4 max-w-3xl font-display text-3xl leading-[1.1] tracking-[-0.01em] text-text-primary md:text-6xl">
            whatever you make, <br className="hidden md:block" />
            <span className="text-warm">Mingla packages it.</span>
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {AUDIENCES.map((audience, i) => (
            <Reveal key={audience.eyebrow} delay={0.05 * i + 0.2}>
              <article className="glass-soft flex h-full flex-col gap-4 rounded-2xl p-6 transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:brightness-105">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-warm">
                  {audience.eyebrow}
                </span>
                <h3 className="font-display text-xl leading-tight tracking-[-0.005em] text-text-primary md:text-2xl">
                  {audience.title}
                </h3>
                <p className="text-sm leading-relaxed text-text-secondary md:text-base">
                  {audience.body}
                </p>
                <span className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-medium text-text-primary">
                  {audience.cta}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
