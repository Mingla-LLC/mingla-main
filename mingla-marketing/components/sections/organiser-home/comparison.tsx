'use client'
import { Reveal, RevealGroup } from '@/components/ui/reveal'
import { SpotlightBand } from '@/components/ui/spotlight-band'

// ORCH-1010 — the bright-line argument, on the first dark SpotlightBand. The
// argument lands harder on the nightlife canvas and rhymes with the consumer
// hero. Struck-through "generic" vs warm "Mingla" per row. On the dark band,
// accent reverts to text-warm (4.71:1 on the night canvas) per the token rule.

interface Contrast {
  category: string
  generic: string
  mingla: string
}

const CONTRASTS: Contrast[] = [
  {
    category: 'Listings',
    generic: 'tell people you exist.',
    mingla: "sells why you're worth choosing tonight.",
  },
  {
    category: 'Ticketing',
    generic: 'sells the ticket.',
    mingla: 'sells the night.',
  },
  {
    category: 'Ads',
    generic: 'chase customers you have to pay for again and again.',
    mingla: 'finds the people already looking for a place like yours.',
  },
  {
    category: 'The group chat',
    generic: 'is where plans go to die.',
    mingla: 'is where they get picked.',
  },
]

export function OrganiserComparison() {
  return (
    <SpotlightBand aria-label="Mingla vs the rest">
      <div className="mx-auto max-w-6xl">
        <Reveal as="span" className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm">
          Mingla vs the rest
        </Reveal>

        <Reveal>
          <h2 className="mt-4 max-w-4xl font-display text-4xl leading-[1.05] tracking-[-0.02em] text-text-primary md:text-7xl">
            they show people your business. <br className="hidden md:block" />
            <span className="text-warm">Mingla shows them why they’d love it.</span>
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-4 md:grid-cols-2">
          <RevealGroup
            items={CONTRASTS}
            step={0.06}
            base={0.2}
            keyFor={(c) => c.category}
          >
            {(contrast) => (
              <article
                className="glass-strong flex h-full flex-col gap-4 rounded-2xl p-6 md:p-8"
                style={{ boxShadow: 'var(--elev-2)' }}
              >
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">
                  {contrast.category}
                </span>

                <p className="text-lg leading-relaxed text-text-muted line-through decoration-text-muted/40">
                  {contrast.generic}
                </p>

                <div className="flex items-baseline gap-2">
                  <span className="font-display text-base text-warm">Mingla</span>
                  <p className="font-display text-xl leading-tight tracking-[-0.005em] text-text-primary md:text-2xl">
                    {contrast.mingla}
                  </p>
                </div>
              </article>
            )}
          </RevealGroup>
        </div>
      </div>
    </SpotlightBand>
  )
}
