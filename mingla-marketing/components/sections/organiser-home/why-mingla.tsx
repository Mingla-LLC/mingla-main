'use client'
import { type ReactNode } from 'react'
import { Reveal, RevealGroup } from '@/components/ui/reveal'
import { EarningsCard } from './earnings-card'

// ORCH-1010 — the insight: people choose feelings before categories. The
// generic→specific pairs are the page's smartest device. The generic-left text
// is de-emphasized but MUST clear AA — so it uses text-text-secondary (6.38 on
// vellum), NOT text-muted (3.29, fails). The quoted category is italic.

interface Pair {
  generic: ReactNode
  specific: string
}

const PAIRS: Pair[] = [
  {
    generic: (
      <>
        they don&rsquo;t want <span className="italic">&ldquo;a restaurant.&rdquo;</span>
      </>
    ),
    specific: 'they want somewhere cute, where they can actually hear each other.',
  },
  {
    generic: (
      <>
        they don&rsquo;t want <span className="italic">&ldquo;an event.&rdquo;</span>
      </>
    ),
    specific: 'they want a night worth leaving the house for.',
  },
  {
    generic: (
      <>
        they don&rsquo;t want <span className="italic">&ldquo;a class.&rdquo;</span>
      </>
    ),
    specific: 'they want a plan that feels fun, useful, or a little bit theirs.',
  },
  {
    generic: (
      <>
        they don&rsquo;t want <span className="italic">&ldquo;a trip.&rdquo;</span>
      </>
    ),
    specific: 'they want the story they’ll tell for years.',
  },
  {
    generic: (
      <>
        they don&rsquo;t want <span className="italic">&ldquo;a bar.&rdquo;</span>
      </>
    ),
    specific: 'they want the right energy, with the right people.',
  },
]

export function OrganiserWhyMingla() {
  return (
    <section className="seam-top bg-vellum px-6 py-24 md:px-10 md:py-40 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]">
      <div className="mx-auto max-w-6xl">
        <Reveal as="span" className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink">
          Why Mingla
        </Reveal>

        <Reveal>
          <h2 className="mt-4 max-w-3xl font-display text-4xl leading-[1.05] tracking-[-0.02em] text-text-primary md:text-7xl">
            because people choose <br className="hidden md:block" />
            <span className="text-warm-ink">feelings before categories.</span>
          </h2>
        </Reveal>

        {/* Two-column on desktop: the feelings→demand argument on the left, an
            illustrative "Earnings" card on the right (ORCH-1010). Stacks on
            mobile. */}
        <div className="mt-16 grid gap-12 lg:grid-cols-[1.45fr_1fr] lg:items-start lg:gap-16">
          <div className="flex flex-col gap-6 md:gap-8">
            <RevealGroup items={PAIRS} step={0.06} base={0.2} keyFor={(_, i) => `pair-${i}`}>
              {(pair) => (
                <div
                  className="grid gap-2 border-t pt-6 md:grid-cols-2 md:gap-8"
                  style={{ borderColor: 'rgba(14,14,16,0.10)' }}
                >
                  <p className="text-base text-text-secondary">{pair.generic}</p>
                  <p className="font-display text-3xl leading-[1.1] tracking-[-0.01em] text-text-primary md:text-5xl">
                    {pair.specific}
                  </p>
                </div>
              )}
            </RevealGroup>
          </div>

          {/* Earnings card — what that demand turns into. */}
          <Reveal delay={0.15} className="lg:sticky lg:top-24">
            <EarningsCard />
          </Reveal>
        </div>

        <Reveal delay={0.5}>
          <p className="mt-16 text-center font-display text-3xl leading-[1.1] tracking-[-0.01em] text-text-primary md:text-5xl">
            Mingla turns those feelings <span className="text-warm-ink">into demand.</span>
          </p>
        </Reveal>
      </div>
    </section>
  )
}
