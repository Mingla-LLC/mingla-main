'use client'
import { motion } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

interface Feature {
  title: string
  body: string
}

const FEATURES: Feature[] = [
  {
    title: 'vibe labeling',
    body: 'Define the energy people should expect: cozy, lively, romantic, social, creative, upscale, low-key, family-friendly, late-night, work-friendly, high-energy, intimate, playful, or bold.',
  },
  {
    title: 'menu and offer storytelling',
    body: 'Turn dishes, drinks, specials, packages, and limited drops into cravings and clear reasons to visit.',
  },
  {
    title: 'ambience positioning',
    body: 'Surface the details people care about: lighting, sound, seating, crowd, dress code, neighborhood, patio, music, layout, pace, and occasion fit.',
  },
  {
    title: 'event and pop-up packaging',
    body: 'Turn your class, show, market, dinner, tasting, activation, or party into something people understand fast and want now.',
  },
  {
    title: 'audience matching',
    body: 'Reach people based on vibe, taste, location, timing, budget, friend plans, saved behavior, and intent.',
  },
  {
    title: 'campaign creation',
    body: 'Generate better titles, descriptions, posts, push copy, email copy, audience angles, and follow-up.',
  },
  {
    title: 'performance learning',
    body: 'See what people save, share, book, buy, attend, and come back for — then improve the next offer.',
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
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.6, delay: reduced ? 0 : delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

export function OrganiserFeatures() {
  return (
    <section className="border-t border-divider px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">
            What Mingla does for you
          </span>
        </Reveal>

        <Reveal delay={0.1}>
          <h2 className="mt-4 max-w-3xl font-display text-3xl leading-[1.1] tracking-[-0.01em] text-text-primary md:text-6xl">
            AI that packages <br className="hidden md:block" />
            your business <span className="text-warm">for demand.</span>
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <Reveal key={feature.title} delay={0.04 * i + 0.2}>
              <article className="glass-soft flex h-full flex-col gap-3 rounded-2xl p-6 transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:brightness-105">
                <h3 className="font-display text-lg leading-tight tracking-[-0.005em] text-text-primary md:text-xl">
                  {feature.title}
                </h3>
                <p className="text-sm leading-relaxed text-text-secondary">
                  {feature.body}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
