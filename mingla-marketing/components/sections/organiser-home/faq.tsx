'use client'
import { motion } from 'framer-motion'
import { FAQAccordion, type FAQItem } from '@/components/ui/faq-accordion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

const FAQS: FAQItem[] = [
  {
    q: 'How does Mingla decide what to show people?',
    a: "Mingla's AI reads your menu, room, vibe, story, and offers, then matches them to people based on taste, mood, location, timing, and intent. The match isn't just 'they're nearby' — it's 'this is what they want tonight.'",
  },
  {
    q: 'What kinds of businesses fit Mingla?',
    a: 'Restaurants, bars, cafés, clubs, activity venues, art galleries, comedy clubs, bowling alleys, taprooms, brand activations, ticketed events, immersive pop-ups, classes, markets — and pretty much any space where people gather to do a thing.',
  },
  {
    q: 'How is Mingla different from listings or ads?',
    a: 'Listings tell people you exist. Ads chase attention. Mingla packages what makes you specifically worth choosing — the vibe, the story, the moment — and matches it with people whose intent fits.',
  },
  {
    q: 'Do I need to upload everything manually?',
    a: 'No. Mingla\'s AI does the heavy lifting — vibe labeling, ambience positioning, menu and offer storytelling, audience targeting, copy generation. You provide the raw material; we shape the demand.',
  },
  {
    q: 'What does Mingla cost?',
    a: 'Pricing is performance-based — you\'re charged when Mingla actually drives action (a booking, a check-in, a sale). No flat fees, no impressions billed. Refunds available if you\'re unsatisfied.',
  },
  {
    q: 'How quickly do I see results?',
    a: 'First placements typically go live within a week of onboarding. Performance data and audience feedback start flowing immediately as people interact with your packaged offer.',
  },
  {
    q: 'Can I see who showed up and what they thought?',
    a: 'Yes — your dashboard shows the full guest list, check-ins, save and share counts, summarized feedback, and individual comments.',
  },
  {
    q: 'Does Mingla replace my existing marketing?',
    a: 'No — it complements it. Mingla is the layer that turns your existing menu, vibe, events, and story into reasons people choose you. Your other channels keep doing what they do; Mingla makes them all work harder.',
  },
]

export function OrganiserFaq() {
  const reduced = useMinglaReducedMotion()

  return (
    <section className="border-t border-divider px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-3xl">
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col gap-4"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">
            Common questions
          </span>
          <h2 className="font-display text-3xl leading-[1.1] tracking-[-0.01em] text-text-primary md:text-5xl">
            before we get on a call.
          </h2>
        </motion.div>

        <motion.div
          initial={reduced ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{
            duration: 0.6,
            delay: reduced ? 0 : 0.15,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mt-12"
        >
          <FAQAccordion items={FAQS} />
        </motion.div>
      </div>
    </section>
  )
}
