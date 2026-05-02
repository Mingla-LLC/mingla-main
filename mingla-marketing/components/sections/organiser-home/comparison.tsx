'use client'
import { motion } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

interface Contrast {
  category: string
  generic: string
  mingla: string
}

const CONTRASTS: Contrast[] = [
  {
    category: 'Listings',
    generic: 'say what you are.',
    mingla: 'sells why you are worth choosing.',
  },
  {
    category: 'Ads',
    generic: 'chase attention.',
    mingla: 'connects you with intent.',
  },
  {
    category: 'Ticketing',
    generic: 'sells entry.',
    mingla: 'sells the reason behind the entry.',
  },
  {
    category: 'Social posts',
    generic: 'disappear.',
    mingla: 'turns your offer into a plan people save, share, book, and buy.',
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

export function OrganiserComparison() {
  return (
    <section className="border-t border-divider px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">
            Mingla vs the rest
          </span>
        </Reveal>

        <Reveal delay={0.1}>
          <h2 className="mt-4 max-w-4xl font-display text-3xl leading-[1.1] tracking-[-0.01em] text-text-primary md:text-6xl">
            ads show people your business. <br className="hidden md:block" />
            <span className="text-warm">Mingla shows them why they should care.</span>
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-4 md:grid-cols-2">
          {CONTRASTS.map((contrast, i) => (
            <Reveal key={contrast.category} delay={0.06 * i + 0.2}>
              <article className="glass-soft flex h-full flex-col gap-4 rounded-2xl p-6">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                  {contrast.category}
                </span>

                <p className="text-base leading-relaxed text-text-muted line-through decoration-text-muted/40 md:text-lg">
                  {contrast.generic}
                </p>

                <div className="flex items-baseline gap-2">
                  <span className="font-display text-base text-warm">Mingla</span>
                  <p className="font-display text-base leading-snug tracking-[-0.005em] text-text-primary md:text-lg">
                    {contrast.mingla}
                  </p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
