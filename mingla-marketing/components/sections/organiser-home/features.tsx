'use client'
import { Reveal } from '@/components/ui/reveal'
import { GrowthOsDashboard } from './growth-os-dashboard'

// ORCH-1010 — "What you get". A compact, centered heading + an interactive
// growth-OS dashboard that cycles through Analytics & ROI, text Blasts, Email
// nurturing, and Ari automation.

export function OrganiserFeatures() {
  return (
    <section className="seam-top px-6 py-24 md:px-10 md:py-32 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]">
      <div className="mx-auto max-w-3xl text-center">
        <Reveal as="span" className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink">
          What you get
        </Reveal>
        <Reveal>
          <h2 className="mx-auto mt-4 max-w-2xl font-display text-3xl leading-[1.06] tracking-[-0.02em] text-text-primary md:text-5xl">
            everything to make your <span className="text-warm-ink">people find you.</span>
          </h2>
        </Reveal>
      </div>

      <Reveal delay={0.1} className="mt-12">
        <GrowthOsDashboard />
      </Reveal>
    </section>
  )
}
