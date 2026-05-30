'use client'
import {
  ArrowRight,
  Compass,
  Martini,
  PartyPopper,
  Sparkles,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'
import { Reveal, RevealGroup } from '@/components/ui/reveal'

// ORCH-1010 — "Built for". Make the owner say "that's me" across the FULL
// experience economy (6 cards incl. Experiences/trips per the Inclusion Rule).
// Each card leads with a real lucide category icon chip (no emoji).

interface Audience {
  icon: LucideIcon
  eyebrow: string
  title: string
  body: string
  cta: string
}

const AUDIENCES: Audience[] = [
  {
    icon: UtensilsCrossed,
    eyebrow: 'Restaurants & cafés',
    title: 'make your menu the reason.',
    body: 'The handmade pasta. The patio at golden hour. The cocktail only your bartender can make. Mingla turns your menu, your room, and your best nights into something people book a table for.',
    cta: 'Fill more tables',
  },
  {
    icon: Martini,
    eyebrow: 'Bars, clubs & nightlife',
    title: 'give people a night they brag about.',
    body: "The DJ. The sound. The room when it's full. The thing everyone wants to be in. Mingla turns your energy into a crowd that shows up — and comes back.",
    cta: 'Build the crowd',
  },
  {
    icon: Users,
    eyebrow: 'Venues & activity spaces',
    title: 'be the plan, not the afterthought.',
    body: 'A date. A birthday. A team night. A weekend ritual. Mingla shapes your space and packages into plans people actively choose — and pay for up front.',
    cta: 'Sell more group plans',
  },
  {
    icon: PartyPopper,
    eyebrow: 'Events & promoters',
    title: 'sell the night, not just the ticket.',
    body: 'A flyer says what’s happening. Mingla says why it matters — the lineup, the crowd, the culture, the timing — and lets people buy in seconds.',
    cta: 'Sell out your event',
  },
  {
    icon: Compass,
    eyebrow: 'Experiences, trips & adventures',
    title: 'turn a thing-to-do into a must-do.',
    body: 'Cooking classes, horseback rides, tours, day trips, tastings, outdoor adventures. Mingla helps experience and trip organizers turn “that sounds fun” into a booking — matched to the people already looking for exactly this.',
    cta: 'Book out your experience',
  },
  {
    icon: Sparkles,
    eyebrow: 'Pop-ups & independent creators',
    title: 'land fast. land hard.',
    body: 'A pop-up has one shot. Mingla helps chefs, artists, makers, and curators turn concept, scarcity, and timing into something people feel they cannot miss.',
    cta: 'Launch your pop-up',
  },
]

export function OrganiserAudiences() {
  return (
    <section className="seam-top px-6 py-24 md:px-10 md:py-40 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]">
      <div className="mx-auto max-w-6xl">
        <Reveal as="span" className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink">
          Built for
        </Reveal>

        <Reveal>
          <h2 className="mt-4 max-w-3xl font-display text-4xl leading-[1.05] tracking-[-0.02em] text-text-primary md:text-7xl">
            whatever you create, <br className="hidden md:block" />
            <span className="text-warm-ink">Mingla makes it the plan.</span>
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <RevealGroup
            items={AUDIENCES}
            step={0.05}
            base={0.2}
            keyFor={(a) => a.eyebrow}
          >
            {(audience) => {
              const Icon = audience.icon
              return (
                <article
                  className="group glass-soft flex h-full flex-col gap-4 rounded-2xl p-6 transition-all duration-200 ease-out-quart hover:-translate-y-0.5 md:p-8"
                  style={{ boxShadow: 'var(--elev-1)' }}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-10 items-center justify-center rounded-full bg-warm/10 text-warm-ink transition-colors duration-200 ease-out-quart group-hover:bg-warm/16"
                  >
                    <Icon className="size-6" strokeWidth={1.8} />
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink">
                    {audience.eyebrow}
                  </span>
                  <h3 className="font-display text-xl leading-tight tracking-[-0.005em] text-text-primary md:text-2xl">
                    {audience.title}
                  </h3>
                  <p className="text-base leading-relaxed text-text-secondary">
                    {audience.body}
                  </p>
                  <span className="mt-auto inline-flex items-center gap-1 pt-2 text-base font-medium text-text-primary">
                    {audience.cta}
                    <ArrowRight
                      className="h-4 w-4 transition-transform duration-200 ease-out-quart group-hover:translate-x-1"
                      aria-hidden="true"
                    />
                  </span>
                </article>
              )
            }}
          </RevealGroup>
        </div>
      </div>
    </section>
  )
}
