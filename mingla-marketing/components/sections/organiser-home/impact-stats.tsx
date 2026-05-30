'use client'
import { Reveal } from '@/components/ui/reveal'
import { SpotlightBand } from '@/components/ui/spotlight-band'

// ORCH-1010 — "By the numbers" impact band on a dark SpotlightBand. Proves how
// much Mingla has helped its partners — revenue, reach, AI enablement, support.
//
// ⚠️ PLACEHOLDER METRICS: these are illustrative figures supplied for layout, NOT
// verified numbers. They MUST be replaced with real, defensible data (or reframed)
// before this ships to the live marketing site — public fabricated metrics violate
// the no-fabricated-data rule and are a trust/legal risk. Operator owns the call.

interface Stat {
  value: string
  label: string
}

const STATS: Stat[] = [
  { value: '$9M+', label: 'in bookings driven for our partners' },
  { value: '120,000+', label: 'guests matched to partners by vibe' },
  { value: '65,000+', label: 'pages, events & experiences built with Ari' },
  { value: '300+', label: 'businesses growing on Mingla' },
]

export function OrganiserImpactStats() {
  return (
    <SpotlightBand aria-label="Mingla impact by the numbers" className="md:py-32">
      <div className="mx-auto max-w-6xl">
        <Reveal as="span" className="block text-center text-xs font-semibold uppercase tracking-[0.2em] text-warm">
          The Mingla effect
        </Reveal>
        <Reveal>
          <h2 className="mx-auto mt-4 max-w-2xl text-center font-display text-3xl leading-[1.1] tracking-[-0.02em] text-white md:text-4xl">
            What that adds up to.
          </h2>
        </Reveal>

        <div className="mt-14 grid grid-cols-2 gap-x-8 gap-y-12 md:mt-16 md:grid-cols-4 md:gap-x-10">
          {STATS.map((s, i) => (
            <Reveal key={s.value} delay={0.08 + i * 0.08}>
              <div className="text-center">
                <div className="font-display text-4xl leading-none tracking-[-0.02em] text-white md:text-5xl">
                  {s.value}
                </div>
                <p className="mx-auto mt-4 max-w-[15rem] text-sm leading-snug text-white/55">
                  {s.label}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </SpotlightBand>
  )
}
