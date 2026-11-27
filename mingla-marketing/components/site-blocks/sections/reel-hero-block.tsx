// #4636 block `reelHero` — the Reelmark hero (Home paper, For hosts night),
// moved from components/site/home-page.tsx and host-page.tsx (R1).
import type { LandingMediaRef } from '@/lib/landing-media-ref'
import { ReelHero } from '@/components/site/reel-hero'
import { RotatingPhrase } from '@/components/site/rotating-phrase'
import { ActionButton, Em, type BlockAction, type BlockProps } from './shared'

export interface ReelHeroContent {
  /** The h1 lines; with phrases, the rotating line goes after the first. */
  lines: readonly string[]
  phrases?: readonly string[]
  srTitle?: string
  sub: string
  cta: BlockAction
  cards: readonly { media: LandingMediaRef; caption: string }[]
}

export function ReelHeroBlock({ content, colour }: BlockProps<ReelHeroContent>) {
  const [first, ...rest] = content.lines
  const phrases = content.phrases ?? []
  return (
    <ReelHero
      dark={colour === 'night'}
      srTitle={content.srTitle}
      title={
        <>
          <span>
            <Em text={first ?? ''} />
          </span>
          {phrases.length ? (
            <span className="rot">
              <RotatingPhrase phrases={phrases} />
            </span>
          ) : null}
          {rest.map((line, i) => (
            <span key={i}>
              <Em text={line} />
            </span>
          ))}
        </>
      }
      sub={content.sub}
      cta={<ActionButton action={content.cta} className="btn cta" location="hero" arrow="prop" />}
      cards={content.cards}
    />
  )
}
