import { type ReactNode } from 'react'
import { Reveal } from '@/components/ui/reveal'
import { SpotlightBand } from '@/components/ui/spotlight-band'

// #2902 — the single conversion action. One band, one primary action, one
// honest sentence about what happens next. No second CTA competing with it and
// no metric bar dressed up as proof.

interface ConversionBandProps {
  heading: ReactNode
  lede: string
  action: ReactNode
  /** What actually happens after the click. Sets expectations, reduces bounce. */
  afterClick: string
}

export function ConversionBand({ heading, lede, action, afterClick }: ConversionBandProps) {
  return (
    <SpotlightBand aria-label="Get started with Mingla" className="py-24 md:py-32">
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <Reveal>
          <h2 className="font-display text-3xl leading-[1.06] tracking-[-0.025em] text-white md:text-[3.25rem]">
            {heading}
          </h2>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-white/70 md:text-lg">{lede}</p>
        </Reveal>
        <Reveal delay={0.16}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">{action}</div>
        </Reveal>
        <Reveal delay={0.22}>
          <p className="mt-5 text-xs leading-relaxed text-white/45">{afterClick}</p>
        </Reveal>
      </div>
    </SpotlightBand>
  )
}
