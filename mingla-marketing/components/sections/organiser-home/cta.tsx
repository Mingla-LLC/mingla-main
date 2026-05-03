'use client'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

export function OrganiserCta() {
  const reduced = useMinglaReducedMotion()

  return (
    <section className="border-t border-divider px-6 py-24 md:px-10 md:py-32">
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative mx-auto flex max-w-3xl flex-col items-center gap-6 text-center"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">
          Ready to give people a reason?
        </span>
        <h2 className="font-display text-3xl leading-[1.05] tracking-[-0.01em] text-text-primary md:text-6xl">
          create the reason. <br className="hidden md:block" />
          <span className="text-warm">Mingla brings it to the right people.</span>
        </h2>
        <p className="max-w-2xl text-base leading-relaxed text-text-secondary md:text-lg">
          Restaurants, bars, venues, promoters, pop-ups, and experience creators — we package what makes you special, match it with the right audience, and turn discovery into bookings, sales, and repeat visits.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" variant="glass">
            Partner with Mingla
          </Button>
        </div>
      </motion.div>
    </section>
  )
}
